import { z } from "zod";

import { expect, test, type APIRequestContext } from "../../fixtures";
import { CleanupRegistry, describeResponse, e2eName, parseWith, readBody } from "../../utils";

/**
 * API example against the public JSONPlaceholder sample. Replace with your own
 * endpoints: keep one feature per file, read-only checks tagged @smoke, and
 * every created record named with e2eName() and deleted through CleanupRegistry.
 */
const Post = z.object({
	id: z.number(),
	userId: z.number(),
	title: z.string().min(1),
	body: z.string(),
});

test.describe("Posts API", { tag: "@DEMO-003" }, () => {
	const cleanup = new CleanupRegistry<APIRequestContext>();

	test.afterEach(async ({ api }) => {
		await cleanup.run(api);
	});

	test("a post is returned by id with its title and author", { tag: "@smoke" }, async ({ api }) => {
		const postId = 1;

		const res = await test.step(`WHEN we fetch post ${postId}`, () => api.get(`posts/${postId}`));

		await test.step("THEN the server answers 200 OK", async () => {
			expect(res.status(), await describeResponse(res)).toBe(200);
		});

		await test.step(`AND the body is post ${postId}, with a title and an author`, async () => {
			const post = parseWith(Post, await readBody(res, test.info()));
			expect(post.id).toBe(postId);
			expect(post.userId).toBeGreaterThan(0);
		});
	});

	test("an unknown post id returns 404", { tag: "@smoke" }, async ({ api }) => {
		const postId = 999_999;

		const res = await test.step(`WHEN we fetch post ${postId}, which does not exist`, async () => {
			const res = await api.get(`posts/${postId}`);
			await readBody(res, test.info());
			return res;
		});

		await test.step("THEN the server answers 404 Not Found", async () => {
			expect(res.status(), await describeResponse(res)).toBe(404);
		});
	});

	test("a created post echoes the title it was sent", async ({ api }) => {
		const title = await test.step("GIVEN a unique post title", () => e2eName("Post"));

		const res = await test.step(`WHEN we create a post titled "${title}"`, () =>
			api.post("posts", { data: { title, body: "Created by the e2e suite", userId: 1 } }));

		await test.step("THEN the server answers 201 Created", async () => {
			expect(res.status(), await describeResponse(res)).toBe(201);
		});

		await test.step(`AND the new post carries the title "${title}" and an id`, async () => {
			const post = parseWith(Post, await readBody(res, test.info()));
			cleanup.add((client) => client.delete(`posts/${post.id}`));
			expect(post.title).toBe(title);
		});
	});
});
