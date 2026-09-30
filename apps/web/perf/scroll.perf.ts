import { test, type Page } from "@playwright/test";

// 스크롤 60fps 측정 (README "Excel 성능 목표"). `pnpm bench`로 돌리고 결과는 표로만 보여준다. (목표를 넘어도 실패하지 않는다)
// ① 프레임 간격: 페이지 안에서 requestAnimationFrame이 불린 시각의 간격을 잰다. 60fps면 16.7ms씩이다.
// ② Chrome 성능 기록: Chrome이 프레임마다 남기는 기록에서 화면에 나간 프레임과 버린 프레임, 그리기 콜백 시간을 센다.
// ③ 그리기 시간만(브라우저 없이)은 packages/excel/src/render.bench.ts에 있다.
// 개발 서버(next dev)에서 잰다. GridView 코드는 배포 빌드와 같지만, 압축되지 않은 코드라 조금 느릴 수 있다.

const FRAME_MS = 1000 / 60;

interface Scenario {
  name: string;
  axis: "x" | "y";
  /** 한 프레임에 움직일 px */
  step: number;
}

const SCENARIOS: Scenario[] = [
  { name: "세로로 천천히 (프레임마다 3행)", axis: "y", step: 60 },
  { name: "세로로 빠르게 (프레임마다 한 화면)", axis: "y", step: 700 },
  { name: "가로로 (프레임마다 반 열)", axis: "x", step: 32 },
];

/** 측정할 프레임 수 (약 5초) */
const FRAMES = 300;

/**
 * /excel을 열고 두 시각을 잰다. (페이지 이동을 시작한 때부터 ms)
 * - 첫 화면: 표와 보이는 셀이 처음 그려진 때. GridView는 만들 때 바로 그리고, 그 직후 window.__excel이 생긴다.
 * - 계산 완료: 나눠서 하는 수식 계산(ADR 0024)이 끝난 때
 */
async function openSheet(page: Page): Promise<{ firstScreen: number; calculated: number }> {
  await page.goto("/excel");
  await page.waitForFunction(() => window.__excel !== undefined, null, { timeout: 60_000, polling: 10 });
  const firstScreen = await page.evaluate(() => performance.now());
  await page.waitForFunction(() => !window.__excel!.state().calculating, null, { timeout: 60_000, polling: 10 });
  const calculated = await page.evaluate(() => performance.now());
  return { firstScreen, calculated };
}

/**
 * 프레임마다 스크롤 위치를 step만큼 옮긴다. 끝에 닿으면 방향을 바꾼다.
 * 사용자가 스크롤바를 끌거나 휠을 굴리는 것과 같이 스크롤 영역의 위치가 바뀌고, GridView가 다음 프레임에 다시 그린다.
 * 돌려주는 값은 requestAnimationFrame이 불린 시각(ms)이다.
 */
function scroll(page: Page, { axis, step }: Scenario, frames: number): Promise<number[]> {
  return page.evaluate(
    ({ axis, step, frames }) =>
      new Promise<number[]>((resolve) => {
        const el = document.querySelector<HTMLElement>('[aria-label="시트"]')!;
        el.scrollTop = 0;
        el.scrollLeft = 0;
        const times: number[] = [];
        let direction = 1;
        const frame = (time: number) => {
          times.push(time);
          if (times.length > frames) return resolve(times);
          const max = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
          const current = axis === "y" ? el.scrollTop : el.scrollLeft;
          if (current + step * direction > max || current + step * direction < 0) direction = -direction;
          if (axis === "y") el.scrollTop = current + step * direction;
          else el.scrollLeft = current + step * direction;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    { axis, step, frames },
  );
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

const ms = (value: number) => value.toFixed(1);

test("페이지 열기 (10만 행 시트 + 수식 20만 개)", async ({ page }) => {
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < 3; i++) {
    const { firstScreen, calculated } = await openSheet(page);
    rows.push({ "첫 화면(ms)": ms(firstScreen), "계산 완료(ms)": ms(calculated) });
  }
  console.log("\n페이지 열기 (페이지 이동 시작부터)");
  console.table(rows);
});

test("① 프레임 간격", async ({ page }) => {
  await openSheet(page);
  const rows: Record<string, string | number>[] = [];
  for (const scenario of SCENARIOS) {
    await scroll(page, scenario, 30); // 준비 운동
    const times = await scroll(page, scenario, FRAMES);
    const intervals = times.slice(1).map((time, i) => time - times[i]!);
    const sorted = [...intervals].sort((a, b) => a - b);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    rows.push({
      상황: scenario.name,
      fps: ms(1000 / mean),
      "평균 간격(ms)": ms(mean),
      "p95 간격(ms)": ms(percentile(sorted, 0.95)),
      "최대 간격(ms)": ms(sorted[sorted.length - 1]!),
      // 한 프레임을 넘겨 1.5배 이상 걸린 간격 = 한 프레임 이상 밀린 것
      "밀린 프레임": intervals.filter((interval) => interval > FRAME_MS * 1.5).length,
    });
  }
  console.log("\n① 프레임 간격 (requestAnimationFrame)");
  console.table(rows);
});

test("② Chrome 성능 기록", async ({ page, browser }) => {
  await openSheet(page);
  const rows: Record<string, string | number>[] = [];
  for (const scenario of SCENARIOS) {
    await scroll(page, scenario, 30);
    await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline.frame"] });
    await scroll(page, scenario, FRAMES);
    const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEvent[] };

    // Chrome은 한 프레임(frame_sequence)에 기록을 여러 개 남기기도 한다. (같은 프레임에 "모두 나감"과 "일부만 나감"이 함께 붙는 식)
    // 프레임 번호별로 묶어 가장 좋은 상태 하나로 센다. 다른 출처가 섞이지 않도록 기록이 가장 많은 출처만 본다.
    const sources = new Map<number, Map<number, Set<string>>>();
    const callbacks: number[] = [];
    for (const event of trace.traceEvents) {
      const reporter = event.args?.frame_reporter;
      if (event.name === "PipelineReporter" && event.ph === "b" && reporter) {
        const frames = sources.get(reporter.frame_source) ?? new Map<number, Set<string>>();
        const states = frames.get(reporter.frame_sequence) ?? new Set<string>();
        states.add(reporter.state);
        frames.set(reporter.frame_sequence, states);
        sources.set(reporter.frame_source, frames);
      }
      if (event.name === "FireAnimationFrame" && event.dur !== undefined) callbacks.push(event.dur / 1000);
    }
    const frames = [...sources.values()].sort((a, b) => b.size - a.size)[0] ?? new Map<number, Set<string>>();
    const count = { presented: 0, partial: 0, dropped: 0 };
    for (const states of frames.values()) {
      if (states.has("STATE_PRESENTED_ALL")) count.presented++;
      else if (states.has("STATE_PRESENTED_PARTIAL")) count.partial++;
      else if (states.has("STATE_DROPPED")) count.dropped++;
    }
    callbacks.sort((a, b) => a - b);
    rows.push({
      상황: scenario.name,
      "화면에 나간 프레임": count.presented,
      // 일부만: 화면은 갱신됐지만 메인 스레드(우리 그리기)가 그 프레임에 늦음
      "일부만 나간 프레임": count.partial,
      "버린 프레임": count.dropped,
      // 프레임마다 스크롤을 옮기는 측정 코드의 콜백(아주 짧음)과 GridView 그리기 콜백이 함께 들어 있다.
      "rAF 콜백 p95(ms)": ms(percentile(callbacks, 0.95)),
      "rAF 콜백 최대(ms)": ms(callbacks[callbacks.length - 1] ?? 0),
    });
  }
  console.log("\n② Chrome 성능 기록 (trace)");
  console.table(rows);
});

interface TraceEvent {
  name: string;
  ph: string;
  dur?: number;
  args?: { frame_reporter?: { state: string; frame_source: number; frame_sequence: number } };
}
