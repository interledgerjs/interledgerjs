// When `stop` is been called:
// - The current `wait` promise (if any) will reject.
// - All future `wait` calls with reject.
export class StoppableTimeout {
  private stopped: boolean = false
  private timer: NodeJS.Timer
  private reject?: (err: Error) => void

  wait (delay: number): Promise<void> {
    if (this.stopped) {
      return Promise.reject(new Error('timer stopped'))
    }

    return new Promise((resolve, reject) => {
      this.timer = setTimeout(resolve, delay)
      this.reject = reject
    })
  }

  stop (): void {
    clearTimeout(this.timer)
    this.stopped = true
    if (this.reject) {
      this.reject(new Error('timer stopped'))
    }
  }
}
