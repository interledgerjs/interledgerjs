const ghpages = require('gh-pages')
const fs = require('fs')

console.log('Publishing docs to Github Pages...')

// Disable Jekyll from parsing docs (because it doesn't like files that start with '_')
fs.writeFileSync('doc/.nojekyll', 'Disable Jekyll\n')

ghpages.publish('doc', {
  src: ['**/*', '.nojekyll'],
  message: 'docs: [skip ci] Publish docs',
  repo: 'git@github.com:interledgerjs/ilp-protocol-stream.git',
  user: {
    name: 'CircleCI',
    email: 'none'
  }
}, function (err) {
  if (err) {
    console.log(err)
    process.exit(1)
  }

  console.log('Published docs')
})
