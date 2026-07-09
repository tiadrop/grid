import { describe, it, expect } from 'vitest'
import { Grid } from '../src/grid'

describe("Grid", () => {
	it("initialises with correct values", () => {
		const fromPipe = Grid.from({
			width: 10,
			height: 15,
			get: (x, y) => x * 100 + y * 2
		});
		const fromInit = Grid.init(10, 15, (x, y) => x * 100 + y * 2);
		expect(fromPipe.get(0, 0)).toBe(0);
		expect(fromInit.get(0, 0)).toBe(0);
		expect(fromPipe.get(4, 3)).toBe(406);
		expect(fromInit.get(4, 3)).toBe(406);
	})
})