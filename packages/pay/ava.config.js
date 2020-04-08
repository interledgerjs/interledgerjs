export default {
  files: ['test/**/*.spec.ts'],
  typescript: {
    rewritePaths: {
      'test/': 'dist/test/'
    }
  }
  // extensions: ['ts'],
  // require: ['ts-node/register']
}
