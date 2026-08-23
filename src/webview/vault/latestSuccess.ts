// Shared async-action confirmation: only the latest successful activation may
// flash a completion state; rejection and superseded work confirm nothing.

export function bindLatestSuccess(
  element: HTMLElement,
  run: () => void | Promise<void>,
  options: { className?: string; durationMs?: number; stopPropagation?: boolean } = {},
): () => void {
  const className = options.className ?? "is-copied";
  const durationMs = options.durationMs ?? 1200;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onClick = (event: MouseEvent): void => {
    if (options.stopPropagation) {
      event.stopPropagation();
    }
    const activation = ++generation;
    clearTimeout(timer);
    element.classList.remove(className);
    void (async () => {
      try {
        await run();
      } catch {
        return;
      }
      if (activation !== generation) {
        return;
      }
      element.classList.add(className);
      timer = setTimeout(() => element.classList.remove(className), durationMs);
    })();
  };

  element.addEventListener("click", onClick);
  return () => {
    generation++;
    clearTimeout(timer);
    element.removeEventListener("click", onClick);
    element.classList.remove(className);
  };
}
