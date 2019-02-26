'use strict'

const assert = require('assert')
const EventEmitter = require('events')
const btp = require('btp-packet')

class OutgoingSocket extends EventEmitter {
  constructor (messages, url) {
    super()
    this.messages = messages
    this.closed = false

    setImmediate(() => {
      if (messages[0].error) {
        const message = messages.shift()
        this.emit('error', message.error)
      } else {
        this.emit('open')
      }
    })
  }

  send (data, opts, cb) {
    if (typeof opts === 'function' && cb === undefined) cb = opts
    setImmediate(() => { // emulates that sending data is asynchronous
      if (cb) cb() // called because sending is finished
      setImmediate(() => { // emulates that receiving a response is asynchronous
        const message = this.messages.shift()
        const gotReq = btp.deserialize(data)
        assert.ok(message, 'Unexpected message ' + JSON.stringify(gotReq))
        const wantReq = Object.assign({ requestId: gotReq.requestId }, message.req)
        assert.deepEqual(gotReq, wantReq)
        if (message.res) {
          this.emit('message', btp.serialize(Object.assign({ requestId: gotReq.requestId }, message.res)))
        }
      })
    })
  }

  close () {
    this.closed = true
  }
}

class Server extends EventEmitter {
  // mock server constructor parameters mirror those found in https://github.com/websockets/ws/blob/master/doc/ws.md
  constructor ({ host, port, backlog, server, verifyClient, handleProtocols, path, noServer, clientTracking, perMessageDeflate, maxPayload }, cb) {
    super()
    this.closed = false
  }

  close () {
    this.closed = true
  }
}

class IncomingSocket extends EventEmitter {
  constructor () {
    super()
    this.responses = []
    this.closed = false
  }

  send (data, opts, cb) {
    if (typeof opts === 'function' && cb === undefined) cb = opts
    this.responses.push(btp.deserialize(data))
    setImmediate(() => { // emulates that sending data is asynchronous
      if (cb) cb() // called because sending is finished
    })
  }

  close () {
    this.closed = true
  }
}

function makeClient (messages) {
  return function (url) { return new OutgoingSocket(messages, url) }
}

module.exports = {
  IncomingSocket,
  Server,
  makeClient,
}
