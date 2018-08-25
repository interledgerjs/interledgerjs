/// <reference types="node" />
import { EventEmitter } from 'events';

declare module 'ilp-plugin' {
  interface Plugin {
    connect (params?: any): Promise<void>;
    disconnect (params?: any): Promise<void>;
    sendData (data: Buffer): Promise<Buffer>;
    sendMoney (amount: string): Promise<void>;
    registerDataHandler: (handler: (data: Buffer) => Promise<Buffer>) => void;
    deregisterDataHandler: () => void;
    registerMoneyHandler: (handler: (amount: string) => Promise<void>) => void;
    deregisterMoneyHandler: () => void;
  }

  function pluginFromEnvironment (opts?: any): Plugin;

  export = pluginFromEnvironment
}

