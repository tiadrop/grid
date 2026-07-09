import { describe, it, expect, test } from 'vitest'
import { Grid } from '../src/grid'
import { Pipe2D } from '@xtia/pipe2d';

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
	});

	describe("Pathfinding", () => {
		it("finds optimal path around obstacles", () => {
			const grid = Grid.from(Pipe2D.fromFlatArrayXY([
				1, 2, 2, 9,
				5, 9, 2, 9,
				1, 2, 3, 9,
				1, 1, 1, 1
			], 4, 4));
			const start = grid.cells.get(0, 0);
			const end = grid.cells.get(3, 3);
			const path = start.findPath(end, c => c.value)!;
			expect(path).toBeTruthy();
			expect(path.map(c => c.value).join("")).toBe("511111");
			// add blockage to bottom-left and try again
			grid.set(0, 3, 4);
			const path2 = start.findPath(end, c => c.value)!;
			expect(path2).toBeTruthy();
			expect(path2.map(c => c.value).join("")).toBe("222311");
		});
	});

})

