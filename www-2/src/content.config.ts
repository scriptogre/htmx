import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

const index = defineCollection({
    loader: glob({ pattern: 'index.md', base: './src/content' }),
    schema: z.object({
        title: z.string(),
        description: z.string(),
    }),
});

const guides = defineCollection({
	loader: glob({ pattern: 'guides{.md,/**/*.md}', base: './src/content' }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
	}),
});

const reference = defineCollection({
    loader: glob({ pattern: 'reference{.md,/**/*.md}', base: './src/content' }),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
    }),
});

const patterns = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/patterns' }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
	}),
});

const essays = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/essays' }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
		date: z.date().optional(),
	}),
});

const sponsors = defineCollection({
	loader: file('src/content/sponsors.json', {
		parser: (text) => {
			const data = JSON.parse(text);
			// Flatten the structure: convert { platinum: [...], silver: [...] } to a flat array with tier property
			const entries = [];
			for (const [tier, sponsors] of Object.entries(data)) {
				for (const sponsor of sponsors) {
					entries.push({
						// Derive id from name by converting to lowercase and replacing spaces with hyphens
						id: sponsor.name.toLowerCase().replace(/\s+/g, '-'),
						tier,
						...sponsor,
					});
				}
			}
			return entries;
		}
	}),
	schema: z.object({
		name: z.string(),
		tier: z.enum(['platinum', 'silver']),
		url: z.string().url(),
		github: z.string().optional(),
		logo: z.string(), // Single logo filename
	}),
});

export const collections = {
    index,
	guides,
	reference,
	patterns,
	essays,
	sponsors,
};
