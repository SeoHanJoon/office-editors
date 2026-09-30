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

async function openSheet(page: Page): Promise<number> {
  const start = Date.now();
  await page.goto("/excel");
  await page.waitForFunction(() => window.__excel !== undefined, null, { timeout: 60_000 });
  return Date.now() - start;
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
  const times: number[] = [];
  for (let i = 0; i < 3; i++) times.push(await openSheet(page));
  console.log(`\n페이지 열기: ${times.map((t) => `${t}ms`).join(", ")}`);
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

    const states = new Map<string, number>();
    const callbacks: number[] = [];
    for (const event of trace.traceEvents) {
      if (event.name === "PipelineReporter" && event.ph === "b") {
        const state = event.args?.frame_reporter?.state ?? "unknown";
        states.set(state, (states.get(state) ?? 0) + 1);
      }
      if (event.name === "FireAnimationFrame" && event.dur !== undefined) callbacks.push(event.dur / 1000);
    }
    const presented = states.get("STATE_PRESENTED_ALL") ?? 0;
    const dropped = (states.get("STATE_DROPPED") ?? 0) + (states.get("STATE_PRESENTED_PARTIAL") ?? 0);
    callbacks.sort((a, b) => a - b);
    rows.push({
      상황: scenario.name,
      "화면에 나간 프레임": presented,
      "버리거나 일부만 나간 프레임": dropped,
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
  args?: { frame_reporter?: { state?: string } };
}
