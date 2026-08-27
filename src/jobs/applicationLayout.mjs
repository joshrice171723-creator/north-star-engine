const SIDEBAR_WIDTH = 210;
const MIN_WORKSPACE_WIDTH = 270;
const MIN_BROWSER_WIDTH = 310;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function getApplicationLayout(viewportWidth, requestedBrowserWidth) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const assistantWidth = clamp(Math.round(width * 0.22), 280, 420);
  const maximumBrowserWidth = Math.max(1, width - SIDEBAR_WIDTH - assistantWidth - MIN_WORKSPACE_WIDTH);
  const preferredBrowserWidth = Number.isFinite(requestedBrowserWidth)
    ? requestedBrowserWidth
    : Math.round(width * 0.36);
  const browserWidth = Math.min(maximumBrowserWidth, Math.max(MIN_BROWSER_WIDTH, preferredBrowserWidth));

  return {
    assistantWidth,
    browserWidth,
    browserLeft: Math.max(SIDEBAR_WIDTH, width - assistantWidth - browserWidth)
  };
}

