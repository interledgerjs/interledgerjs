import path from 'path'
import { Configuration, ProvidePlugin } from 'webpack'

const config: Configuration = {
  mode: 'development',
  entry: './test/browser/main.ts',
  resolve: {
    aliasFields: ['browser'],
    extensions: ['.tsx', '.ts', '.js', '.json'],
    fallback: {
      fs: false,
      net: false,
      tls: false,
      crypto: false,
      assert: require.resolve('assert/'),
      buffer: require.resolve('buffer/'),
      events: require.resolve('events/'),
      process: require.resolve('process/browser'),
      util: require.resolve('util/'),
      stream: require.resolve('stream-browserify'),
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: {
          onlyCompileBundledFiles: true,
          configFile: path.resolve(__dirname, '../../tsconfig.build.json'),
        },
      },
    ],
  },
  output: {
    filename: 'dist/test/browser/bundle.js',
    path: path.resolve(__dirname, '../..'),
  },
  optimization: { usedExports: true },
  plugins: [
    new ProvidePlugin({
      process: require.resolve('process/browser'),
      Buffer: ['buffer', 'Buffer'],
    }),
  ],
}

export default config
