module.exports = {
  branches: ['release', { name: 'main', channel: 'next', prerelease: 'alpha' }],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release placeholder syntax
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    '@semantic-release/npm',
    ['@semantic-release/github', { failComment: false }],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        // biome-ignore lint/suspicious/noTemplateCurlyInString: semantic-release placeholder syntax
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
  ],
}
