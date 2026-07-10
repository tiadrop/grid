import { describe, it, expect, vitest } from 'vitest'
import { OrderedQueue } from "../src/utils";

describe("OrderedQueue", () => {
	it("gives lowest-cost item first", () => {
		const q = new OrderedQueue(v => v, 4, 1, 6);
		q.add(2);
		expect(q.take()).toBe(1);
		expect(q.take()).toBe(2);
		expect(q.take()).toBe(4);
		expect(q.take()).toBe(6);
	});
	it("throws on empty take", () => {
		const q = new OrderedQueue(v => v, 4);
		const take = vitest.fn(() => q.take());
		expect(take).not.toThrow();
		expect(take).toThrow();
	});
	it("reports correct length", () => {
		const q = new OrderedQueue(v => v, 4);
		expect(q.length).toBe(1);
		q.add(5);
		expect(q.length).toBe(2);
		q.take();
		expect(q.length).toBe(1);
	});
})