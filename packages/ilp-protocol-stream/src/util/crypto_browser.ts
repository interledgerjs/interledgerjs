const webCrypto = crypto
const HASH_ALGORIGHM = 'SHA-256'
const ENCRYPTION_ALGORITHM = 'AES-GCM'
const ENCRYPTION_KEY_STRING = Buffer.from('ilp_stream_encryption', 'utf8')
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const BIT_AUTH_TAG_LENGTH = 8*AUTH_TAG_LENGTH
const ENCRYPTION_OVERHEAD = 28
const FULFILLMENT_GENERATION_STRING = Buffer.from('ilp_stream_fulfillment', 'utf8')

const TOKEN_LENGTH = 18
const SHARED_SECRET_GENERATION_STRING = Buffer.from('ilp_stream_shared_secret', 'utf8')

function generateToken () {
  console.log('generateToken')
  return generateRandomCondition(TOKEN_LENGTH)
}

// Not used for Web Javascript - No Tests
async function generateTokenAndSharedSecret (seed) { 
  console.log('generateTokenAndSharedSecret')
  const token = generateRandomCondition(TOKEN_LENGTH)
  const sharedSecret = await generateSharedSecretFromTokenAsync(seed, token)
  return { token, sharedSecret }
}

// Sync no-op for Web Javascript - No Tests
async function generateSharedSecretFromToken (seed, token) {
  console.log('generateSharedSecretFromToken SHOULD NEVER BE CALLED!!!!')
  return 'no-op for javascript'
}

async function generateSharedSecretFromTokenAsync (seed, token) {
  console.log('generateSharedSecretFromTokenAsync')
  console.log(SHARED_SECRET_GENERATION_STRING)
  const keygen = await hmac(Buffer.from(seed), SHARED_SECRET_GENERATION_STRING)
  console.log('keygen', keygen)
  console.log('token', token)
  const sharedSecret = await hmac(keygen, Buffer.from(token))
  console.log('sharedSecret', sharedSecret)
  // return sharedSecret
  return Buffer.from(sharedSecret)
}

function generateRandomCondition (size = 32) {
  console.log('generateRandomCondition')
  const randArray = new Uint8Array(size)
  const randValues = webCrypto.getRandomValues(randArray)
  return Buffer.from(randValues)
  // return Buffer.from(randValues.buffer) //TODO: Not sure if this might be the right way
}

async function generatePskEncryptionKey (sharedSecret) {
  console.log('generatePskEncryptionKey')
  const pskKey = await hmac(sharedSecret, ENCRYPTION_KEY_STRING)
  return Buffer.from(pskKey)
}

async function generateFulfillmentKey (sharedSecret) { 
  console.log('generateFulfillmentKey')
  const fulfillmentKey = await hmac(sharedSecret, FULFILLMENT_GENERATION_STRING)
  return Buffer.from(fulfillmentKey)
}

async function generateFulfillment (fulfillmentKey, data) {
  console.log('generateFulfillment')
  const dataBuf = Buffer.from(data)
  const fulfillment = await hmac(fulfillmentKey, dataBuf)
  return Buffer.from(fulfillment)
}

async function hash (preimage) { 
  console.log('hash')
  const digest = await webCrypto.subtle.digest(
    {
        name: HASH_ALGORIGHM,
    },
    getArrayBufferFromBuffer(preimage)
  )
  console.log(digest)
  return Buffer.from(digest)
}

async function encrypt (pskEncryptionKey, ...buffers) { //ASSUMING ASYNC//TODO: Test
  console.log('encrypt')

  const iv = webCrypto.getRandomValues(new Uint8Array(IV_LENGTH))
  console.log('iv', iv) 
  const alg = { name: ENCRYPTION_ALGORITHM, iv: iv, tagLength: BIT_AUTH_TAG_LENGTH } 
  const key = await webCrypto.subtle.importKey(
    'raw', 
    pskEncryptionKey, 
    alg, 
    false, 
    ["encrypt", "decrypt"]
  )
  console.log('encrypt key', key)
  console.log('encrypt buffers', buffers)
  const arrBuf = Buffer.from(buffers)
  console.log('encrypt arrBuf', arrBuf)
  // const dataArray = new Uint8Array()
  // for (let buffer of buffers) {
  //   console.log('loop start')
  //   console.log(Buffer.from(buffer))
  //   dataArray.push(buffer)
  // }
  // console.log('dataArray', dataArray)
  // const dataBuffer = Buffer.concat(buffers, buffers)
  // console.log('dataBuffer', dataBuffer)
  // const ctBuffer = await webCrypto.subtle.encrypt(
  //   alg,
  //   key,
  //   getArrayBufferFromBuffer(dataBuffer)
  // )
  const ctBuffer = await webCrypto.subtle.encrypt(
    alg,
    key,
    Buffer.from(buffers)
  )
  console.log('encrypt ctBuffer', ctBuffer.byteLength)
  const TAG_START = ctBuffer.byteLength - ((AUTH_TAG_LENGTH + 7) >> 3)
  const tag = ctBuffer.slice(TAG_START)
  const data = ctBuffer.slice(0, TAG_START)
  console.log('encrypt iv', iv)
  console.log('encrypt tag', tag)
  console.log('encrypt data', data)
  const dataArr = Buffer.concat([Buffer.from(iv), Buffer.from(tag), Buffer.from(data)]) //TODO: CUt off tag
  console.log('encrypt dataArr', dataArr)
  console.log('encrypt dataArr.length', dataArr.length)
  // const encryptKey = await webCrypto.subtle.importKey(
  //   "raw",
  //   pskEncryptionKey,
  //   {
  //     name: ENCRYPTION_ALGORITHM
  //   },
  //   false,
  //   ["encrypt", "decrypt"]
  // )

  // const cipherText = await webCrypto.subtle.encrypt(
  //   {
  //     name: ENCRYPTION_ALGORITHM,
  //     iv: webCrypto.getRandomValues(new Uint8Array(IV_LENGTH)),
  //     tagLength: BIT_AUTH_TAG_LENGTH
  //   },
  //   encryptKey, 
  //   dataBuffer
  // )
  // console.log(cipherText)
  // console.log('end encrypt')
  // return cipherText
  return dataArr
}

async function decrypt (pskEncryptionKey, data) { //ASSUMING ASYNC//TODO: Test
  console.log('decrypt')
  console.log('decrypt data', data)
  console.log('decrypt data.length', data.length)

  const nonce = data.slice(0, IV_LENGTH)
  const TAG_LENGTH = 2
  const tag = data.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const encrypted = data.slice(IV_LENGTH + TAG_LENGTH)
  console.log('decrypt nonce',nonce)
  console.log('decrypt tag', tag)
  console.log('decrypt encrypted', encrypted)
  const iv = webCrypto.getRandomValues(new Uint8Array(IV_LENGTH))
  console.log('iv', iv) 
  const alg = { name: ENCRYPTION_ALGORITHM, iv: nonce, tagLength: BIT_AUTH_TAG_LENGTH } 
  const key = await webCrypto.subtle.importKey(
    'raw', 
    pskEncryptionKey, 
    alg, 
    false, 
    ["encrypt", "decrypt"]
  )
  console.log('decrypt key', key) 
  const testBuffer = Buffer.from('cccc')
  const decryptedData = await webCrypto.subtle.decrypt(
    alg,
    key, //from generateKey or importKey above
    testBuffer
    // Buffer.from(encrypted) //ArrayBuffer of the data
  )
  console.log('decrypt decryptedData', decryptedData)
  return decryptedData
}

// Tested indirectly by other functions, not directly accessed by STREAM
async function hmac (key, message) { 
  console.log('hmac')
  const hmacKey = await webCrypto.subtle.importKey(
    "raw", 
    key, //TODO: Do we need to get the array buffer here? The key should already be an ArrayBuffer I think...  
    {   
      name: "HMAC",
      hash: {name: HASH_ALGORIGHM}
    },
    false,
    ["sign", "verify"] 
  )
  console.log('hmacKey ', hmacKey)
  
  const signature = await webCrypto.subtle.sign(
    {
        name: "HMAC",
    },
    hmacKey,
    getArrayBufferFromBuffer(message) 
  )
  console.log('signature', signature)
  return signature
}

function getArrayBufferFromBuffer (nodeBuffer) {
  return nodeBuffer.buffer.slice(
    nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength
  )
  // const webArray = Array.from(nodeBuffer)
  // return new Uint8Array(webArray)
}

//  return Promise.resolve({ token, sharedSecret })

// module.exports = {
//   ENCRYPTION_OVERHEAD,
//   generateToken,
//   generateTokenAndSharedSecret,
//   generateSharedSecretFromTokenAsync,
//   generateRandomCondition,
//   generatePskEncryptionKey,
//   generateFulfillmentKey,
//   generateFulfillment,
//   hash,
//   encrypt,
//   decrypt,
// }
