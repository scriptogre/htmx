import { summaryReporter, defaultReporter } from '@web/test-runner'

const config = {
  testRunnerHtml: testFramework => `
  <html lang="en">
<head>
    <meta charset="utf-8" />
    <title>htmx Tests (Draft)</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="htmx:config" content='{"logAll":false}'>
    <style>
        ::view-transition-group(*),
        ::view-transition-old(*),
        ::view-transition-new(*) {
            animation-duration: 0s;
        }
    </style>
</head>
<body>

<h2>Htmx Draft Test Suite</h2>

<script src="node_modules/chai/chai.js"></script>
<script src="test/lib/fetch-mock.js"></script>
<script src="src/htmx.draft.js"></script>
<script src="test/lib/draft-shim.js"></script>

<script class="mocha-init">
    window.should = window.chai.should()
    window.assert = window.chai.assert
</script>

<script src="test/lib/helpers.js"></script>
<script type="module" src="${testFramework}"></script>

<div id="test-playground"></div>

</body>
</html>`,

  nodeResolve: true,
  coverage: false,
  files: ['test/tests/attributes/hx-get.js', 'test/tests/attributes/hx-post.js', 'test/tests/attributes/hx-trigger.js'],
  reporters: [
    summaryReporter({ flatten: false, reportTestLogs: false, reportTestErrors: true }),
    defaultReporter({ reportTestProgress: true, reportTestResults: true }),
  ],
}

export default config
