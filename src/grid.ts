import { Pipe2D } from "@xtia/pipe2d";
import { GetXYFunc, OrderedQueue, Source2D } from "./utils.js";

type ChangeEvent<T> = {
	changedCells: Set<Cell<T>>;
}

type EventMap<T> = {
	change: ChangeEvent<T>;
}

type BatchState<T> = {
	level: number;
	changedCells: Set<Cell<T>>;
}

type PathFindOptions<T> = {
	maxCost?: number;
	allowDiagonal?: boolean;
	onVisit?: (info: {cell: Cell<T>, cost: number}) => void;
	shortcutMap?: Source2D<LocationSpec<T>[] | undefined> | GetXYFunc<LocationSpec<T>[] | undefined>;
}

type CostMapOptions<T> = PathFindOptions<T> & {
	stopAt?: LocationSpec<T>;
}

type VisibilityOptions = {
	maxDistance?: number;
	boundariesVisible?: boolean;
}

type LocationSpec<T> = Cell<T> | [number, number];

export enum TraversalType {
	cardinal,
	diagonal,
	shortcut
}

type CostFunc<T> = (cell: Cell<T>, context: {
	traversalType: TraversalType;
	from: Cell<T>;
}) => number;

type RectSpec = (
	{
		left: number;
		width: number;
		right?: undefined;
	} | {
		left: number;
		width?: undefined;
		right: number;
	} | {
		left?: undefined;
		width: number;
		right: number;
	}
) & (
	{
		top: number;
		height: number;
		bottom?: undefined;
	} | {
		top: number;
		height?: undefined;
		bottom: number;
	} | {
		top?: undefined;
		height: number;
		bottom: number;
	}
)

const cardinalOffsets = [[-1,0],[1,0],[0,-1],[0,1]];
const allOffsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

export class Cell<T> {
	constructor(
		public readonly x: number,
		public readonly y: number,
		private gridView: Grid<T>,
	) {}

	/**
	 * The value held in this cell.
	 */
	get value() {
		return this.gridView.get(this.x, this.y);
	}

	set value(v) {
		this.gridView.set(this.x, this.y, v);
	}

	/**
	 * Get a Cell from a location, specified as Cell or [x,y], throwing if given a foreign Cell.
	 * @param location 
	 * @returns 
	 */
	private getSiblingCell(location: LocationSpec<T>) {
		if (Array.isArray(location)) return this.gridView.cells.get(...location);
		if (location.gridView !== this.gridView) {
			throw new Error("Target cell belongs to a different Grid");
		}
		return location;
	}

	/**
	 * Get [x,y] from a location, specified as Cell or [x,y], throwing if given a foreign Cell.
	 * @param location 
	 * @returns 
	 */
	private getSiblingXY(location: LocationSpec<T>): [number, number] {
		if (Array.isArray(location)) return location;
		if (location.gridView !== this.gridView) {
			throw new Error("Target cell belongs to a different Grid");
		}
		return [location.x, location.y];
	}

	/**
	 * Returns an array of neighbouring cells.
	 * @param includeDiagonals 
	 * @returns Neighbouring cells
	 */
	getNeighbours(includeDiagonals: boolean = false) {
		const offsets = includeDiagonals 
			? allOffsets
			: cardinalOffsets;

		return offsets
			.map(o => this.look(o[0], o[1]))
			.filter(v => v) as Cell<T>[];
	}

	/**
	 * Gets a cell located at a position relative to this one.
	 * 
	 * If the relative position is outside of the grid's bounds, `undefined` is returned.
	 * @param xDelta X offset
	 * @param yDelta Y offset
	 * @returns Relatively-positioned cell, if it exists, otherwise undefined.
	 */
	look(xDelta: number, yDelta: number) {
		const [x, y] = [this.x + xDelta, this.y + yDelta];
		if (x < 0 || x >= this.gridView.width || y < 0 || y >= this.gridView.height) return undefined;
		return this.gridView.cells.get(xDelta + this.x, yDelta + this.y);
	}

	/**
	 * Computes an optimal path from this Cell to another, based on a cell costing predicate.
	 * @param target Destination cell or [x, number] coordinates
	 * @param getCost Function that returns the movement cost for traversing a cell. Return `Infinity` for impassable cells.
	 * @param options Configuration for pathfinding behavior (max cost, diagonal movement, etc).
	 * @returns Optimal path as array of Cells, or null if no path exists.
	 */
	findPath(
		target: LocationSpec<T>,
		getCost: CostFunc<T> | Map<T, number>,
		options: PathFindOptions<T> = {}
	): Cell<T>[] | null {
		const pathMap = this.calculateCosts(getCost, {
			...options,
			stopAt: target,
		}, true);

		return pathMap?.get(...this.getSiblingXY(target));
	}

	/**
	 * Computes a map of optimal paths from this cell, based on a cell costing predicate.
	 * 
	 * When queried, a path map provides an array of `Cell<T>` for reachable locations (otherwise `null`) according to `getCost` and
	 * grid state **at time of the path map's creation**.
	 * @param getCost Function that returns the movement cost for traversing a cell
	 * @param options Configuration for pathfinding behavior (max cost, diagonal movement, etc)
	 * @returns Map containing optimal paths to all reachable cells. Unreachable cells are mapped as `null`.
	 */
	getPathMap(
		getCost: CostFunc<T> | Map<T, number>,
		options: PathFindOptions<T> = {}
	) {
		return this.calculateCosts(
			getCost,
			options,
			true,
		)
	}

	/**
	 * Computes a map of optimal path costs from this Cell, based on a cell costing predicate.
	 * @param getCost Function that returns the movement cost for traversing a cell
	 * @param options Configuration for pathfinding behavior (max cost, diagonal movement, etc)
	 * @returns Map containing costs for all reachable cells. Unreachable cells are costed `Infinity`.
	 */
	getCostMap(
		getCost: CostFunc<T> | Map<T, number>,
		options: CostMapOptions<T> = {}
	) {
		return this.calculateCosts(getCost, options)
	}

	private calculateCosts(
		getCost: CostFunc<T> | Map<T, number>,
		options: CostMapOptions<T>,
	): Pipe2D<number>
	private calculateCosts(
		getCost: CostFunc<T> | Map<T, number>,
		options: CostMapOptions<T>,
		asPathMap: true,
	): Pipe2D<Cell<T>[] | null>
	private calculateCosts(
		getCost: CostFunc<T> | Map<T, number>,
		options: CostMapOptions<T>,
		asPathMap: boolean = false
	): Pipe2D<number> | Pipe2D<Cell<T>[] | null> {
		const visited = new Set<Cell<T>>();
		const costs = new Map<Cell<T>, number>();
		const maxCost = options.maxCost ?? Infinity;
		const pathInfo = asPathMap
			? new Map<Cell<T>, Cell<T>>()
			: null;

		const getCostFn = getCost instanceof Map
			? (cell: Cell<T>) => getCost.get(cell.value) ?? Infinity
			: getCost;
		
		costs.set(this, 0);

		const queue = new OrderedQueue<Cell<T>>([this, 0]);

		const stopAtCell = options.stopAt && this.getSiblingCell(options.stopAt);

		// calculate costs with Dijkstra
		while (queue.length > 0) {
			const current = queue.take();
			
			if (visited.has(current)) continue;
			visited.add(current);
			options.onVisit?.({cell: current, cost: costs.get(current)!});
			
			if (stopAtCell && current === stopAtCell) {
				break;
			}
			
			const currentCost = costs.get(current)!;
			
			const neighbours = current.getNeighbours(options.allowDiagonal).map(cell => ({
				traversalType: cell.x == current.x || cell.y == current.y
					? TraversalType.cardinal
					: TraversalType.diagonal,
				cell
			}));

			const shortcutCells = typeof options.shortcutMap == "function"
				? options.shortcutMap(current.x, current.y)
				: options.shortcutMap?.get(current.x, current.y);

			if (shortcutCells) {
				const shortcuts = shortcutCells.map(loc => this.getSiblingCell(loc)).map(cell => ({
					traversalType: TraversalType.shortcut,
					cell
				}));
				neighbours.push(...shortcuts);
			}
			
			neighbours.forEach(n => {
				if (visited.has(n.cell)) return;
				
				const moveCost = getCostFn(n.cell, {
					traversalType: n.traversalType,
					from: current,
				});
				if (moveCost === Infinity) return;
				
				const newCost = currentCost + moveCost;
				const oldCost = costs.get(n.cell) ?? Infinity;
				
				if (newCost < oldCost && newCost <= maxCost) {
					costs.set(n.cell, newCost);
					pathInfo?.set(n.cell, current);
					queue.add(n.cell, newCost);
				}
			});
		}

		// construct path map, if requested
		if (pathInfo) {
			// only cache directly queried paths
			// but if a cached path is encountered during a resolution, reuse it
			const cache = new Map<Cell<T>, Cell<T>[]>();
			return this.gridView.cells.map(targetCell => {
				if (targetCell === this) return [];
				if (cache.has(targetCell)) return cache.get(targetCell)!;
				if (!pathInfo.has(targetCell)) return null;

				let current: Cell<T> = targetCell;
				let path: Cell<T>[] = [];
				
				while (current !== this) { // 'this' being the subject cell of this pathmap (path start)
					if (cache.has(current)) { // best path to current is already known
						path.unshift(...cache.get(current)!);
						cache.set(targetCell, path);
						return path;
					}
					path.unshift(current);
					current = pathInfo.get(current)!;
				}
				
				cache.set(targetCell, path);
				return path;
			});
		}

		// otherwise return the cost map
		return this.gridView.cells.map(costs, () => Infinity)
			.strict();
	}

	getLineTo(target: LocationSpec<T>): IterableIterator<Cell<T>> 
	getLineTo(x: number, y: number): IterableIterator<Cell<T>>
	*getLineTo(targetOrX: LocationSpec<T> | number, _targetY?: number): IterableIterator<Cell<T>>{
		const [targetX, targetY] = typeof targetOrX == "number"
			? [targetOrX, _targetY!]
			: this.getSiblingXY(targetOrX);
		
		if (this.x === targetX && this.y === targetY) {
			yield this;
			return;
		}
		
		const dx = Math.abs(targetX - this.x);
		const dy = Math.abs(targetY - this.y);
		const sx = this.x < targetX ? 1 : -1;
		const sy = this.y < targetY ? 1 : -1;
		let err = dx - dy;
		
		let x = this.x;
		let y = this.y;
		
		while (true) {
			const cell = this.gridView.cells.get(x, y);
			if (cell) {
				yield cell;
			}
			
			if (x === targetX && y === targetY) {
				break;
			}
			
			const e2 = 2 * err;
			
			if (e2 > -dy) {
				err -= dy;
				x += sx;
			}
			
			if (e2 < dx) {
				err += dx;
				y += sy;
			}
		}
	}

	/**
	 * Creates a Pipe2D of values representing each location's visibility from this cell, depending on the user-provided `isClear` predicate.
	 * 
	 * The resulting visibility map is live; changes to the Grid can affect subsequent queries to the map.
	 * @param isClear Function that returns true for cells that allow vision.
	 * @param options Optional configuration; Euclidian visibility distance, boundaries visible.
	 * @returns Map of every cell's visibility from this cell
	 */
	createVisibilityMap(
		isClear: (cell: Cell<T>) => boolean,
		options: VisibilityOptions = {},
	): Pipe2D<boolean> {
		const maxDistance = options.maxDistance;
		const boundariesVisible = options.boundariesVisible ?? true;
		return new Pipe2D<boolean>(
			this.gridView.width,
			this.gridView.height,
			(x, y) => {
				if (!isClear(this)) {
					return x === this.x && y === this.y ? boundariesVisible : false;
				}

				if (maxDistance !== undefined) {
					if (getDistance(this, { x, y }) > maxDistance) {
						return false;
					}
				}
				
				for (const cell of this.getLineTo([x, y])) {
					if (isClear(cell)) continue;
					return cell.x === x && cell.y === y
						? boundariesVisible
						: false;
				}
				
				return true;
			}
		);
	}

}

function getDistance(c1: {x: number, y: number}, c2: {x: number, y: number}): number {
    return Math.sqrt(Math.pow(c2.x - c1.x, 2) + Math.pow(c2.y - c1.y, 2));
}

export class Grid<T> {

	/**
	 * A `Pipe2D` of this grid's Cells, providing location-based functionality
	 * 
	 * @see https://github.com/tiadrop/pipe2d
	 */
	readonly cells = new Pipe2D(this.width, this.height, (x, y) => {
		if (x < 0 || x >= this.width || y < 0 || y >= this.height || !Number.isInteger(x) || !Number.isInteger(y)) {
			throw new RangeError(`Cell coordinates must be bounded integers; got (${x}, ${y})`);
		}
		return new Cell(x, y, this)
	}).withCache();

	protected constructor(
		public readonly width: number,
		public readonly height: number,
		private parentGet: GetXYFunc<T>,
		private parentSet: (x: number, y: number, value: T) => void,
		private batch: (cb: () => void) => void,
	) {
		if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
			throw new Error(`Grid width & height must be non-negative integers; got (${width} x ${height})`);
		}
	}

	/**
	 * A `Pipe2D` of this grid's values.
	 * 
	 * `Pipe2D` is a lazily-evaluated 2D pipeline. Values produced by the pipeline reflect the grid's state when the pipeline is queried.
	 * 
	 * @see {@link https://github.com/tiadrop/pipe2d}
	 */
	pipe = new Pipe2D(this);

	/**
	 * Executes a custom callback without triggering any `change` events on the underlying GridBase until the callback concludes
	 * @param fn Callback to run while change events are suppressed
	 */
	batchUpdate(fn: () => void) {
		this.batch(fn);
	}

	/**
	 * Retrieves the value at the specified coordinates.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @returns Value read from this grid position
	 */
	get(x: number, y: number) {
		this.assertValidCoordinates(x, y);
		return this.parentGet(x, y);
	}

	/**
	 * Sets a value at the specified coordinates.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @param value Value to store
	 */
	set(x: number, y: number, value: T) {
		this.assertValidCoordinates(x, y);
		this.parentSet(x, y, value);
	}

	/**
	 * Sets a value at the specified coordinates if they are within the grid's dimensions.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @param value Value to store
	 * @returns `true` if the write was successful (in-bounds), otherwise `false`.
	 */
	trySet(x: number, y: number, value: T): boolean {
    	if (
			x < 0
			|| x >= this.width
			|| y < 0
			|| y >= this.height
		) return false;
    	this.parentSet(x, y, value);
    	return true;
	}

	/**
	 * Sets every cell's value.
	 * @param value Value to store
	 * @param mask Optional 2D boolean source (Grid, Pipe2D, etc) to specify which cells should be modified. Only cells at locations (relative to the target grid) where the mask provides `true` will be changed.
	 */
	fill(value: T) {
		this.batchUpdate(() => {
			for (let y = 0; y < this.height; y++) {
				for (let x = 0; x < this.width; x++) {
					this.parentSet(x, y, value);
				}
			}
		});
	}

	/**
	 * Copies values from a 2D source (Grid, Pipe2D, etc) to this Grid.
	 * @param source Source to copy values from
	 * @param x Destination X coordinate (default: 0)
	 * @param y Destination Y coordinate (default: 0)
	 */
	paste(source: Source2D<T>, x?: number, y?: number): void
	/**
	 * Replaces every value in the Grid with values returned by a `(x, y) => T` predicate
	 * @param get A function, called for each cell location, returning a new value for that cell
	 */
	paste(get: GetXYFunc<T>): void
	paste(_source: Source2D<T> | GetXYFunc<T>, x: number = 0, y: number = 0): void {
		this.assertValidCoordinates(x, y, true);
		const source = typeof _source == "function"
			? new Pipe2D(this.width, this.height, _source)
			: _source;
		const sourcePipe = source instanceof Pipe2D ? source : new Pipe2D(source);
		const cachedSource = sourcePipe.stash();

		this.batchUpdate(() => {
			for (let oy = 0; oy < source.height; oy++) {
				for (let ox = 0; ox < source.width; ox++) {
					const tx = ox + x, ty = oy + y;
					if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) continue;
					this.parentSet(tx, ty, cachedSource.get(ox, oy));
				}
			}
		});
	}

	/**
	 * Creates a view of this grid that only writes to allowed locations according to a mask source/function.
	 * @param mask A Source2D or a function that provides `true` to allow writing, `false` to suppress writing, at a given location
	 * @returns A write-masked grid
	 */
	writeMask(mask: Source2D<boolean> | GetXYFunc<boolean>) {
		const getMask = typeof mask == "function"
			? mask
			: (x: number, y: number) => mask.get(x, y);
		return new Grid(
			this.width,
			this.height,
			this.parentGet,
			(x, y, v) => {
				const writable = getMask(x, y);
				if (writable) {
					this.parentSet(x, y, v);
				}
			},
			cb => this.batch(cb),
		)
	}

	*[Symbol.iterator](): IterableIterator<T> {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				yield this.get(x, y);
			}
		}
	}

	/**
	 * Perform a callback on every value in this Grid
	 * @param callback Callback to run for every cell's value
	 */
	forEach(callback: (value: T, x: number, y: number) => void): void {
		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				callback(this.get(x, y), x, y);
			}
		}
	}

	/**
	 * Creates a *two-way* transformed view of this Grid.
	 * 
	 * Changes to this grid will be reflected in the resulting view, and vice-versa.
	 * 
	 * For a read-only, lazily evaluated view of this Grid, see {@link pipe | `grid.pipe`}.
	 * @param read Function to transform values from the parent grid
	 * @param write Function to transform values back to the parent grid
	 * @returns A new Grid that provides a transformed view of this grid
	 */
	map<U>(
		read: (initial: T, x: number, y: number) => U,
		write: ((local: U, x: number, y: number) => T)
	) {
		return new Grid(
			this.width,
			this.height,
			(x, y) => read(this.parentGet(x, y), x, y),
			(x, y, value) => this.parentSet(x, y, write(value, x, y)),
			fn => this.batch(fn),
		)
	}

	/**
	 * Creates a regional view of this Grid.
	 * 
	 * Changes to this grid will be reflected in the resulting view, and vice-versa, as well as any overlapping regions of the same parent.
	 * @param x X coordinate
	 * @param y Y coordinate
	 * @param width Region width
	 * @param height Region height
	 * @returns Regional view of this Grid.
	 */
	region(x: number, y: number, width: number, height: number): Grid<T>
	/**
	 * **Experimental**
	 * 
	 * Creates a regional view of this Grid by specifying a rect that can be expressed as distances from top, left, right and bottom edges
	 * @param rect 
	 */
	region(rect: RectSpec): Grid<T>
	region(xOrRect: number | RectSpec, y: number = 0, width: number = 0, height: number = 0): Grid<T> {
		let x: number;
		if (typeof xOrRect == "number") {
			x = xOrRect;
		} else {
			if (xOrRect.left === undefined) {
				width = xOrRect.width; // {right, width}
				x = (this.width - 1 - xOrRect.right) - width + 1;
			} else {
				x = xOrRect.left;
				width = xOrRect.width === undefined
					? (this.width - 1 - xOrRect.right) - x + 1  // {left, right}
					: xOrRect.width;  // {left, width}
			}
			if (xOrRect.top === undefined) {
				height = xOrRect.height; // {bottom, height}
				y = (this.height - 1 - xOrRect.bottom) - height + 1;
			} else {
				y = xOrRect.top;
				height = xOrRect.height === undefined
					? (this.height - 1 - xOrRect.bottom) - y + 1  // {top, bottom}
					: xOrRect.height;  // {top, height}
			}
		}

		this.assertValidCoordinates(x, y);
		if (!Number.isInteger(width) || !Number.isInteger(height)) {
			throw new Error("Region dimensions must be integer");
		}
		if (x + width > this.width || y + height > this.height) {
			throw new RangeError("Requested region exceeds the parent's bounds");
		}

		return new Grid(
			width,
			height,
			(tx, ty) => {
				return this.parentGet(tx + x, ty + y)
			},
			(tx, ty, value) => {
				this.parentSet(tx + x, ty + y, value)
			},
			fn => this.batch(fn),
		)
	}

	/**
	 * Shifts all content in the grid by X/Y offsets, filling the created gaps with a specific value
	 * @param xDelta X offset
	 * @param yDelta Y offset
	 * @param fill Value to write at edge gaps
	 */
	scroll(xDelta: number, yDelta: number, fill: T): this {
		this.assertValidCoordinates(xDelta, yDelta, true);
		this.paste(this, xDelta, yDelta);

		if (xDelta > 0) {
			this.region(0, 0, xDelta, this.height).fill(fill);
		} else if (xDelta < 0) {
			this.region(this.width + xDelta, 0, -xDelta, this.height).fill(fill);
		}
		
		if (yDelta > 0) {
			this.region(0, 0, this.width, yDelta).fill(fill);
		} else if (yDelta < 0) {
			this.region(0, this.height + yDelta, this.width, -yDelta).fill(fill);
		}
		
		return this;
	}

	/**
	 * Creates a {@link GridBase | `GridBase`}, initialising every value by means of custom function.
	 * @param width Width of the new Grid
	 * @param height Height of the new Grid
	 * @param initCell Callback to initialise cells
	 * @returns A new GridBase of the specified dimensions.
	 */
	static init<T>(width: number, height: number, initCell: (x: number, y: number) => T): GridBase<T>
	/**
	 * Creates a {@link GridBase | `GridBase`}, using the dimensions of and initialising every value from a 2D source (Grid, Pipe2D, etc).
	 * @param source A 2D source to provide dimensions and initial values
	 * @returns A new GridBase, initialised with values read from `source`.
	 */
	static init<T>(source: Source2D<T>): GridBase<T>
	static init<T>(widthOrSource: number | Source2D<T>, height?: number, initCell?: (x: number, y: number) => T): GridBase<T> {
		if (typeof widthOrSource == "object") return new GridBase(widthOrSource);
		return new GridBase({
			width: widthOrSource!,
			height: height!,
			get: initCell!
		});
	}

	/**
	 * Creates a {@link GridBase | `GridBase`} with every cell initialised to a specified value.
	 * @param width Width of the new Grid
	 * @param height Height of the new Grid
	 * @param fillValue Value to initialise every cell with
	 * @returns A new GridBase of the specified dimensions.
	 */
	static solid<T>(width: number, height: number, fillValue: T) {
		return new GridBase(Pipe2D.solid(fillValue, width, height));
	}

	/**
	 * Creates a **proxy Grid** to interact with any existing read/write 2D structure with Grid's API
	 * @param width Width of the grid
	 * @param height Height of the grid
	 * @param get Callback that gets a value from the parent structure
	 * @param set Callback that sets a value on the parent structure
	 * @param batch Optional function that instructs the parent to perform an operation in batching mode, if supported
	 * @returns A Grid view of the parent
	 * @example
	 * ```ts
	 * const array2D = [[1, 2], [3, 4]];
	 * const grid = Grid.wrap(
	 *   2, 2,
	 *   (x, y) => array2D[y][x],
	 *   (x, y, value) => array2D[y][x] = value
	 * );
	 * grid.set(0, 0, 99); // array2D[0][0] is now 99
	 * ```
	 */
	static wrap<T>(
		width: number,
		height: number,
		get: (x: number, y: number) => T,
		set: (x: number, y: number, value: T) => void,
		batch: (callback: () => void) => void = cb => cb()
	) {
		return new Grid(width, height, get, set, batch);
	}

	private assertValidCoordinates(x: number, y: number, ignoreBounds: boolean = false) {
		if (!Number.isInteger(x) || !Number.isInteger(y)) {
			throw new Error(`Coordinates must be integer; got (${x}, ${y})`)
		}
		if (!ignoreBounds && (x < 0 || x >= this.width || y < 0 || y >= this.height)) {
			throw new RangeError(`Coordinates out of bounds (${x}, ${y}) / (${this.width}, ${this.height})`);
		}
	}
}

/**
 * A storage and control Grid layer.
 * 
 * Unlike {@link Grid}, which acts as an interface for manipulating a region or two-way transformation of a parent Grid, `GridBase` maintains the underlying data.
 */
export class GridBase<T> extends Grid<T> {
	private data: T[];
	private eventHandlers: {
		[k in keyof EventMap<T>]?: {fn: (ev: EventMap<T>[k]) => void}[]
	} = {};

	private triggerEvent<K extends keyof EventMap<T>>(name: K, data: EventMap<T>[K]) {
		this.eventHandlers[name]?.forEach(obj => obj.fn(data));
	}
	private batchState: null | BatchState<T> = null;

	batchUpdate(fn: () => void) {
		if (this.batchState) {
			this.batchState.level++;
		} else {
			this.batchState = {
				level: 1,
				changedCells: new Set()
			}
		}
		fn();
		this.batchState.level--
		if (this.batchState.level == 0) {
			const changed = this.batchState.changedCells;
			this.batchState = null;
			if (changed.size > 0) this.triggerChange(changed);
		}
	}

	constructor(source: Source2D<T>) {
		super(
			source.width,
			source.height,
			(x, y) => this.data[y * this.width + x],
			(x, y, value) => this._set(x, y, value),
			fn => this.batchUpdate(fn),
		);

		const sourcePipe = source instanceof Pipe2D
			? source
			: new Pipe2D(source)
			
		this.data = sourcePipe.toFlatArrayXY();
	}

	on<K extends keyof EventMap<T>>(eventName: K, handler: (data: EventMap<T>[K]) => void) {
		const unique = {fn: handler};
		if (!this.eventHandlers[eventName]) this.eventHandlers[eventName] = [];
		this.eventHandlers[eventName]!.push(unique);
		return () => {
			const idx = this.eventHandlers[eventName]!.indexOf(unique);
			if (idx === -1) throw new Error("Event handler was already retired");
			this.eventHandlers[eventName]!.splice(idx, 1);
		}
	}

	private _set(x: number, y: number, value: T) {
		const idx = y * this.width + x;
		if (this.data[idx] === value) return;
		this.data[idx] = value;
		if (this.batchState) {
			this.batchState.changedCells.add(this.cells.get(x, y));
			return;
		}
		if (this.eventHandlers.change) {
			this.triggerChange(new Set([this.cells.get(x, y)]));
		}
	}

	private triggerChange(changed: Set<Cell<T>>) {
		this.triggerEvent("change", {changedCells: changed});
	}
}
