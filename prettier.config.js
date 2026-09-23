/** @type {import('prettier').Config} */
const config = {
	arrowParens: 'avoid',
	printWidth: 100,
	singleQuote: true,
	trailingComma: 'none',
	useTabs: true,
	plugins: ['prettier-plugin-jsdoc'],
	overrides: [{ files: '*.svelte', options: { parser: 'svelte' } }]
};

export default config;
