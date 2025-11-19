// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';

// https://astro.build/config
export default defineConfig({
	site: 'https://four.htmx.org',
	vite: {
		plugins: [tailwindcss()],
	},
	markdown: {
		rehypePlugins: [
			rehypeSlug,
			[rehypeAutolinkHeadings, {
				behavior: 'wrap',
			}],
		],
		shikiConfig: {
            theme: 'dracula',
        }
	},
	redirects: {
		'/migration-guide-hotwire-turbo': '/guides/migration/turbo-to-htmx',
		'/migration-guide-htmx-1': '/guides/migration/htmx-1-to-2',
		'/migration-guide-htmx-4': '/guides/migration/htmx-2-to-4',
		'/migration-guide-intercooler': '/guides/migration/intercooler-to-htmx',
        '/htmx-4': '/guides/migration/htmx-2-to-4',
	}
});
