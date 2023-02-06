// When `stop` has been called:
// - The current `wait` promise (if any) will reject.
// - All future `wait` calls will reject.
export class StoppableTimeout {
  private stopped = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private timer?: any // TypeScript can get confused between dom and NodeJS
  private reject?: (err: Error) => void

  wait(delay: number): Promise<void> {
    if (this.stopped) {
      return Promise.reject(new Error('timer stopped'))
    }

    return new Promise((resolve, reject) => {
      this.timer = setTimeout(resolve, delay)
      this.reject = reject
    })
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.stopped = true
    if (this.reject) {
      this.reject(new Error('timer stopped'))
    }
  }
}
