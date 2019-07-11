/* eslint-disable */
import { execSync } from 'child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { inspect } from 'util'

interface Itsconfig {
  extends?: string
  references?: {path: string}[]
  compilerOptions?: Record<string, any> & {
    composite?: boolean
    paths?: Record<string, string[]>
    outDir?: string
    baseUrl?: string
  }
  exclude?: string[]
  include?: string[]
}

const IDE_CONFIG_NAME = 'tsconfig.json'
const BUILD_CONFIG_NAME = 'tsconfig.build.json'

const pretty = (val: any) => inspect(val, { depth: Infinity })
const prettyJSON = (val: any) => JSON.stringify(val, null, 2)

// eslint-disable-next-line no-console
const log = console.log

/**
 * TODO: get a json parser impl that handles comments and trailing commas
 */
const readFileJSON = (path: string) => {
  const jsonString = readFileSync(path)
    .toString()
    .split('\n')
    .filter(line => !line.trimLeft().startsWith('//'))
    .join('\n')
  log('jsonString', jsonString)
  return JSON.parse(jsonString)
}
const relativeToRoot = (path: string) => resolve(__dirname, path)

const packageScopes = execSync('npx lerna ls --toposort')
  .toString()
  .trim()
  .split('\n')

const packagePaths = packageScopes.map(scope => {
  const [_, packageName] = scope.split('/')
  const [category, ...packages] = packageName.split('-')
  return resolve(__dirname, 'packages', category, packages.join('-'))
})

const srcPaths = packagePaths.map(p => join(p, 'src'))
const testPaths = packagePaths.map(p => join(p, 'test'))

const rootTsConfigPath = relativeToRoot(IDE_CONFIG_NAME)
log({ rootTsConfigPath })
const rootTsConfig = readFileJSON(rootTsConfigPath)
log(pretty(rootTsConfig))

const srcLeafConfig: Itsconfig = {
  extends: '../../../../tsconfig.json',
  compilerOptions: {
    composite: true,
    baseUrl: '.',
    outDir: '../build'
  },
  include: ['.']
}

const testLeafConfig: Itsconfig = {
  extends: '../../../../tsconfig.test.json',
  compilerOptions: {
    composite: true
  },
  references: [
    {
      path: '../src/tsconfig.build.json'
    }
  ]
}
function removeLeafIDEConfig (srcPath: string) {
  const ideTsConfigPath = join(srcPath, IDE_CONFIG_NAME)
  log({ tsconfigPath: ideTsConfigPath })
  if (existsSync(ideTsConfigPath)) {
    log(ideTsConfigPath, readFileSync(ideTsConfigPath).toString())
    log(`Removing leaf ${IDE_CONFIG_NAME}`, ideTsConfigPath)
    unlinkSync(ideTsConfigPath)
  }
}

srcPaths.forEach(srcPath => {
  removeLeafIDEConfig(srcPath)
  writeFileSync(join(srcPath, BUILD_CONFIG_NAME), prettyJSON(srcLeafConfig))
})

testPaths.forEach(testPath => {
  removeLeafIDEConfig(testPath)
  writeFileSync(join(testPath, IDE_CONFIG_NAME), prettyJSON(testLeafConfig))
})

log({ packages: packageScopes })
log({ packagePaths })
log({ srcPaths })
log({ testPaths })

const script = `
yarn clean;
yarn;
yarn test
`
writeFileSync('reset.sh', script)
execSync('bash ./reset.sh', { stdio: 'inherit' })
