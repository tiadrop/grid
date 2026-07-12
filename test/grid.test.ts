import { describe, it, expect, test, vitest } from 'vitest'
import { Cell, Grid } from '../src/grid'
import { Pipe2D } from '@xtia/pipe2d';
import { Source2D } from '../src/utils';

const fn = vitest.fn;

function gridToString<T>(source: Source2D<string | number>): string {
    return new Pipe2D(source).toFlatArrayXY().join("");
}

describe("Grid", () => {
	it("initialises from Source2D with correct values", () => {
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

	describe("Cell operations", () => {
		test("cell.value reads & writes source", () => {
			const base = Grid.solid(4, 4, false);
			const cell = base.cells.get(1, 1);
			expect(cell.value).toBe(false);
			cell.value = true;
			expect(base.get(1, 1)).toBe(true);
		});
		test("cell.look() returns relative cell", () => {
			const base = Grid.solid(4, 4, false);
			base.set(1, 1, true);
			const topLeft = base.cells.get(0, 0);
			const inset = topLeft.look(1, 1)!;
			expect(inset).toBeTruthy();
			expect(inset.value).toBe(true);
			expect(inset.look(100, 0)).not.toBeTruthy();
		});
		test("cells are consistently identified", () => {
			const base = Grid.solid(4, 4, false);
			const cell1 = base.cells.get(0, 0);
			const cell2 = base.cells.get(0, 0);
			expect(cell1).toBe(cell2);
			expect(cell1.look(0, 1)?.look(0, -1)).toBe(cell1);
		});

		test("line-to-self returns only self", () => {
			const grid = Grid.solid(5, 5, 0);
			const cell = grid.cells.get(3, 3);
			const line = [...cell.getLineTo([3, 3])];
			expect(line.length).toBe(1);
			expect(line[0]).toBe(cell);
		});
		test("diagonal line is correct length", () => {
			const grid = Grid.solid(8, 8, 0);
			const topLeft = grid.cells.get(0, 0);
			const topRight = grid.cells.get(7, 0);
			const bottomRight = grid.cells.get(7, 7);
			expect([...topLeft.getLineTo(bottomRight)].length).toBe(8);
			expect([...topLeft.getLineTo(topRight)].length).toBe(8);
		});

		describe("Pathfinding", () => {
			const pathTestData = Pipe2D.fromFlatArrayXY([
				1, 2, 2, 9,
				5, 9, 2, 9,
				1, 2, 3, 9,
				1, 1, 1, 1
			], 4, 4);

			test("flood-fill using getCostMap()", () => {
				const grid = Grid.from(pathTestData);
				// test with 1-tolerance
				const mask = grid.cells.get(2, 3).getCostMap((cell, context) => {
					return Math.abs(context.from.value - cell.value) <= 1 ? 0 : Infinity
				}).map((cost) => cost == 0);
				grid.writeMask(mask).fill(7);
				expect(gridToString(grid)).toBe("7779597977797777");
				grid.paste(pathTestData);
				// test with 0-tolerance
				const mask2 = grid.cells.get(2, 0).getCostMap((cell, context) => {
					return cell.value === context.from.value ? 0 : Infinity;
				}).map((cost) => cost == 0);
				grid.writeMask(mask2).fill(7);
				expect(gridToString(grid)).toBe("1779597912391111");
			});

			test("finds optimal path around obstacles", () => {
				const grid = Grid.from(pathTestData);
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

			test("pathing to foreign cells throws", () => {
				const base = Grid.solid(5, 5, 1);
				const start = base.cells.get(1, 1);
				const region = base.region(0, 0, 4, 4);
				const target = region.cells.get(3, 3);
				const fn = () => start.findPath(target, c => c.value);
				expect(fn).toThrow();
			});

			test("reusable path maps", () => {
				const grid = Grid.from(pathTestData);
				const start = grid.cells.get(0, 0);
				const paths = start.getPathMap(c => c.value);
				const toCorner = paths.get(3, 3);
				const to3 = paths.get(2, 2);
				expect(toCorner?.map(c => c.value).join("")).toBe("511111");
				expect(to3?.map(c => c.value).join("")).toBe("2223");
			});

			test("shortcuts", () => {
				const grid = Grid.from(pathTestData);
				const start = grid.cells.get(0, 0);
				const end = grid.cells.get(3, 3);
				const path = start.findPath(
					end,
					c => c.value,
					{
						shortcutMap: (x, y) => (x == 2 && y == 0) ? [[1, 3]] : undefined
					}
				);
				expect(path?.map(c => c.value).join("")).toBe("22111");
			});

		});

		describe("Visibility map", () => {
			test("respects maxDistance", () => {
				const grid = Grid.solid(100, 100, 0);
				const viewer = grid.cells.get(30, 30);
				const vis = viewer.createVisibilityMap(() => true, {
					maxDistance: 5,
				});
				expect(vis.get(viewer.x + 4, viewer.y)).toBe(true);
				expect(vis.get(viewer.x + 6, viewer.y)).toBe(false);
			})
		})

	});

	test("regions are self-bounded", () => {
		const base = Grid.solid(10, 10, false);
		const corner = base.region(0, 0, 3, 3);
		const read = fn(() => corner.get(5, 0));
		const write = fn(() => corner.set(5, 0, true));
		expect(read).toThrow();
		expect(write).toThrow();
	});

	test("region writes affect parents at correct offset", () => {
		const base = Grid.solid(5, 5, 0);
		const corner = base.region(3, 3, 2, 2);
		corner.set(1, 1, 1);
		expect(base.get(4, 4)).toBe(1);
		expect(base.cells.get(4, 4).getNeighbours(true)).not.toContain(1);
	});

	test("user-supplied storage is correctly read & written", () => {
		const store = [
			[0, 1, 2, 3],
			[4, 5, 6, 7],
			[8, 9, 10, 11],
			[12, 13, 14, 15]
		];
		const grid = Grid.wrap(4, 4, (x, y) => store[y][x], (x, y, v) => store[y][x] = v);
		expect(grid.get(0, 3)).toBe(12);
		grid.set(2, 1, 100);
		expect(store[1][2]).toBe(100);
	});

	test("fill()", () => {
		const base = Grid.solid(3, 3, 0);
		base.fill(4);
		base.region(1, 1, 2, 2).fill(5);
		/* 444
		   455
		   455 */
		expect(gridToString(base)).toBe("444455455")
	});

	describe("change event", () => {
		test("triggers on set", () => {
			const base = Grid.solid(4, 4, 0);
			const handler = fn((event: any) => {
				expect(event.changedCells.size).toBe(1);
			});
			base.on("change", handler);
			expect(handler).not.toHaveBeenCalled();
			base.set(1, 1, 5);
			expect(handler).toHaveBeenCalled();
		});
		test("handlers are correctly removed", () => {
			const grid = Grid.solid(4, 4, 0);
			const handler = fn();
			const remove = grid.on("change", handler);
			grid.set(2, 2, 2);
			expect(handler).toHaveBeenCalled();
			remove();
			grid.set(3, 3, 3);
			expect(handler).toHaveBeenCalledTimes(1);
		});
		test("suspended during batchUpdate", () => {
			const base = Grid.solid(4, 4, 0);
			const checkCell = base.cells.get(0, 0);
			const handler = fn((event: any) => {
				expect(event.changedCells.size).toBe(3);
				expect(event.changedCells.has(checkCell)).toBeTruthy();
			});
			base.on("change", handler);
			expect(handler).not.toHaveBeenCalled();
			base.batchUpdate(() => {
				checkCell.value = 5;
				base.set(1, 0, 5);
				base.set(0, 1, 5);
				expect(handler).not.toHaveBeenCalled();
			});
			expect(handler).toHaveBeenCalled();
		});
		test("don't trigger on duplicate write", () => {
			const grid = Grid.solid(2, 2, 0);
			const handler = fn();
			grid.on("change", handler);
			grid.set(0, 0, 0);
			expect(handler).not.toHaveBeenCalled();
		})
	});

	test("pasting", () => {
		const base = Grid.from(Pipe2D.fromFlatArrayXY([
			0,0,1,1,
			0,1,1,1,
			0,2,2,1,
			1,2,2,3
		], 4, 4));
		const brush = Grid.from(Pipe2D.fromFlatArrayXY([
			5,5,5,
			6,6,6,
			7,7,7
		], 3, 3));
		base.paste(brush, 1, 1);
		expect(gridToString(base)).toBe("0011055506661777");
	});

	test("Write-masking", () => {
		const base = Grid.from(Pipe2D.fromFlatArrayXY([
			0,0,1,1,
			0,1,1,1,
			0,2,2,1,
			1,2,2,3
		], 4, 4));
		const brush = Grid.from(Pipe2D.fromFlatArrayXY([
			5,5,5,
			6,6,6,
			7,7,7
		], 3, 3));
		const mask = Pipe2D.fromFlatArrayXY([
			1,1,0,0,
			1,1,0,0,
			0,0,0,0,
			1,1,1,0
		], 4, 4).map(n => n == 1);
		base.writeMask(mask).paste(brush, 1, 1);
		expect(gridToString(base)).toBe("0011051102211773");
		base.writeMask(mask.map(w => !w)).fill(9);
		expect(gridToString(base)).toBe("0099059999991779");
	});

	test("content scrolling", () => {
		const grid = Grid.from(Pipe2D.fromFlatArrayXY([
			1,2,3,
			4,5,6,
			7,8,9
		], 3, 3));
		expect(grid.get(0, 1)).toBe(4);
		grid.scroll(1, 0, 0);
		/* 012
		   045
		   078 */
		expect(gridToString(grid)).toBe("012045078");
		grid.scroll(-1, 1, 9);
		/* 999
		   129
		   459 */
		expect(gridToString(grid)).toBe("999129459");		   
	});

	describe("Invalid operations", () => {
		test("negative dimensions", () => {
			expect(fn(() => Grid.init(-1, 1, () => 1))).toThrow();
			expect(fn(() => Grid.init(1, -1, () => 1))).toThrow();
			const base = Grid.solid(3, 3, 0);
			expect(fn(() => base.region(0, 0, -1, 1))).toThrow();
			expect(fn(() => base.region(0, 0, 1, -1))).toThrow();
		});
		test("leaky region", () => {
			const base = Grid.solid(3, 3, 0);
			expect(fn(() => base.region(0, 0, 4, 2))).toThrow();
			expect(fn(() => base.region(-1, 0, 1, 1))).toThrow();
		});
		test("fractional coordinates", () => {
			const base = Grid.solid(3, 3, 0);
			expect(fn(() => base.set(0, 0.5, 1))).toThrow();
			expect(fn(() => base.region(0.5, 0.5, 1, 1))).toThrow();
			expect(fn(() => base.scroll(0.5, 0, 0))).toThrow();
		});
	})

})

