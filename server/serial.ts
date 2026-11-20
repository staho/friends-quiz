// Runs tasks one at a time, in the order they were queued. A task that throws
// rejects its own promise and does not block the tasks behind it.
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return function run<T>(task: () => T | Promise<T>): Promise<T> {
    const result = tail.then(task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
