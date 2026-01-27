import {defineCollection, z} from "astro:content";
import {glob, file} from "astro/loaders";
import {slugify} from "./lib/utils.ts";
import yaml from "js-yaml";

const pages = defineCollection({
    loader: glob({base: "./src/content", pattern: "{index,about}.mdx"}),
    schema: z.object({
        title: z.string(),
        description: z.string(),
        breadcrumbs: z.array(z.object({
            label: z.string(),
            href: z.string().optional(),
        })).optional(),
        iconClass: z.string().optional(),
    }).strict(),
});

const docs = defineCollection({
    loader: glob({base: "./src/content", pattern: "docs{.md,.mdx,/**/*.md,/**/*.mdx}"}),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
        iconClass: z.string().optional(),
    }).strict(),
});

/**
 * Reference Collection
 *
 * GROUPING STRATEGY:
 * - Folder structure defines main sections (Attributes, Headers, etc.)
 * - Tag-based grouping within folders for subsections
 * - _index.md files define groups with tag, title, and description
 * - Individual files reference tags for grouping
 *
 * FIELDS:
 * - title: Display name (e.g., "hx-get", "HX-Boosted", "Attributes")
 * - description: Brief description
 * - iconClass: Icon class for the folder (only for _index.md files)
 * - groups: Tag group definitions (only for _index.md files)
 * - tags: Array of tags for grouping (only for individual files)
 * - signature: Optional value signature/format (e.g., "{URL}", "true", "function()")
 */
const reference = defineCollection({
    loader: glob({base: "./src/content/reference", pattern: "{*.md,**/*.md}"}),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
        iconClass: z.string().optional(),
        groups: z.array(z.object({
            tag: z.string(),
            title: z.string(),
            description: z.string().optional(),
        })).optional(),
        tags: z.array(z.string()).optional(),
        signature: z.union([
            z.string(),
            z.array(z.string()),
            z.boolean()
        ]).optional().transform(sig => {
            if (!sig) return sig;

            // Handle boolean
            if (typeof sig === 'boolean') {
                return sig.toString();
            }

            // Process string or array
            let processed = '';
            if (Array.isArray(sig)) {
                processed = sig.join('<b> | </b>');
            } else {
                processed = sig.replace(/\s*\|\s*/g, '<b> | </b>');
            }

            // Escape angle brackets for placeholders (but preserve HTML tags)
            processed = processed.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            processed = processed.replace(/&lt;(\/?)strong&gt;/g, '<$1strong>');
            processed = processed.replace(/&lt;(\/?)b&gt;/g, '<$1b>');
            processed = processed.replace(/&lt;a\s+href="([^"]*)"&gt;/g, '<a href="$1">');
            processed = processed.replace(/&lt;\/a&gt;/g, '</a>');

            return processed;
        }),
    }).strict(),
});

const examples = defineCollection({
    loader: glob({base: "./src/content/examples", pattern: "{*.md,**/*.md}"}),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
        image: z.string().optional(),
        iconClass: z.string().optional(),
        groups: z.array(z.object({
            tag: z.string(),
            title: z.string(),
            description: z.string().optional(),
        })).optional(),
        tags: z.array(z.string()).optional(),
    }).strict(),
});

const essays = defineCollection({
    loader: glob({base: "./src/content/essays", pattern: "{index.mdx,**/*.md,**/*.mdx}"}),
    schema: z.object({
        title: z.string(),
        description: z.string().optional(),
        created: z.date().optional(),
        modified: z.date().optional(),
        authors: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
    }).strict(),
});

const sponsors = defineCollection({
    loader: file('src/content/sponsors.yaml', {
        parser: (fileContent) => (yaml.load(fileContent) as any[]).map((sponsor) => (
            {
                ...sponsor,
                id: slugify(sponsor.name),
                url: sponsor.tracking !== false
                    ? `${sponsor.url}?utm_source=htmx&utm_medium=sponsorship&utm_campaign=${sponsor.tier}-sponsor-${new Date().getFullYear()}`
                    : sponsor.url,
            }))
    }),
    schema: z.object({
        id: z.string(), // generated from `name`
        name: z.string(),
        url: z.string().url(),
        github: z.string().optional(),
        image: z.string(),
        tier: z.enum(['bronze', 'silver', 'gold', 'platinum']),
        tracking: z.boolean().default(true),
    }).strict(),
});

const community = defineCollection({
    loader: file('src/content/community.yaml', {
        parser: (fileContent) => (yaml.load(fileContent) as any[]).map((item) => ({...item, id: slugify(item.name)}))
    }),
    schema: z.object({
        id: z.string(), // generated from `name`
        name: z.string(),
        description: z.string(),
        iconClass: z.string(),
        url: z.string(),
    }).strict(),
})

const resources = defineCollection({
    loader: file('src/content/resources.yaml', {
        parser: (fileContent) => (yaml.load(fileContent) as any[]).map((resource) => ({
            ...resource,
            id: slugify(resource.name)
        }))
    }),
    schema: z.object({
        id: z.string(), // generated from `name`
        name: z.string(),
        description: z.string(),
        iconClass: z.string(),
        url: z.string(),
    }).strict(),
})

const team = defineCollection({
    loader: file('src/content/team.yaml', {
        parser: (fileContent) => (yaml.load(fileContent) as any[]).map((member) => ({
            ...member,
            id: slugify(member.name)
        }))
    }),
    schema: z.object({
        id: z.string(), // generated from `name`
        name: z.string(),
        image: z.string(),
        github: z.string().optional(),
        content: z.string(),
    }).passthrough(),
})

const podcasts = defineCollection({
    loader: file('src/content/podcasts.yaml', {
        parser: (fileContent) => (yaml.load(fileContent) as any[]).map((podcast) => ({
            ...podcast,
            id: slugify(podcast.name)
        }))
    }),
    schema: z.object({
        id: z.string(), // generated from `name`
        name: z.string(),
        url: z.string().url(),
    }).strict(),
})


export const collections = {
    pages,
    docs,
    reference,
    examples,
    essays,
    sponsors,
    community,
    resources,
    team,
    podcasts,
};

/**
 * Collection UI metadata
 *
 * Visual styling (colors, icons) for content collections
 * used across breadcrumbs, search results, and other UI elements.
 */
export type Collection = 'docs' | 'reference' | 'examples';

export interface CollectionMeta {
    color: string;
    hover: string;
    icon: string;
}

export const COLLECTIONS: Record<Collection, CollectionMeta> = {
    reference: {
        color: 'text-violet-600 dark:text-violet-400',
        hover: 'hover:text-violet-700 dark:hover:text-violet-300',
        icon: 'icon-[mdi--code-braces]'
    },
    docs: {
        color: 'text-blue-600 dark:text-blue-400',
        hover: 'hover:text-blue-700 dark:hover:text-blue-300',
        icon: 'icon-[mdi--book-open-page-variant]'
    },
    examples: {
        color: 'text-emerald-600 dark:text-emerald-400',
        hover: 'hover:text-emerald-700 dark:hover:text-emerald-300',
        icon: 'icon-[mdi--flask-outline]'
    }
} as const;
