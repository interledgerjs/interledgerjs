export class AgingSet {
  private newSet: Set<string> = new Set()
  private oldSet: Set<string> = new Set()
  private timer: NodeJS.Timer

  /**
   * `cycleInterval` specifies the frequency that the sets are swapped.
   */
  constructor (cycleInterval: number) {
    this.timer = setInterval(this.rotate.bind(this), cycleInterval)
  }

  close () {
    clearInterval(this.timer)
  }

  has (element: string): boolean {
    return this.newSet.has(element) || this.oldSet.has(element)
  }

  add (element: string) {
    this.newSet.add(element)
  }

  private rotate () {
    const newSet = this.newSet
    const oldSet = this.oldSet
    this.oldSet = newSet
    this.newSet = oldSet
    this.newSet.clear()
  }
}
