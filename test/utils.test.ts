import { describe, it, expect, beforeEach } from 'vitest'
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
})