// TODO Implement a `Sender` that does this and can be stopped imperatively! Should be pretty simple ---
// great for WM

import { SenderContext, SendState, StreamSender } from './controllers'

// TODO `streamMoney` function

class WebMonetization implements StreamSender<boolean> {
  // TODO
  nextState({ send, lookup }: SenderContext<boolean>): SendState<boolean> {
    // TODO Implement this!
  }
}
