# `Grid`

**Alpha**: Pre-0.1.0 API details may change

## Summary

A mutable 2D grid with efficient region views, spatial operations, and seamless interoperability with [Pipe2D](https://github.com/tiadrop/pipe2d). Store, edit, and transform 2D data with an ergonomic API designed for practical use.

## Features

- **Mutable 2D storage** with type safety
- **Zero-copy region views** - edit or provide subgrids and transformation layers without copying
- **Spatial operations** - fill, paste, flood fill, pathfinding
- **First-class Pipe2D interoperability** – use grids as sources for pipes, or pipes as sources for grids
- **Consistent API** - for grids, regions, and your existing 2D structures
- **Mask support** - apply operations to arbitrary shapes

## Example

```
npm i @xtia/grid
```

```ts
import { Grid } from "@xtia/grid"; // ~4.8kb gzipped

// initialise a 30x20 Grid<number> of 0's
const numGrid = Grid.solid(30, 20, 0);

// change a value
numGrid.set(3, 3, 50);

// initialise a chessboard
const chessGrid = Grid.init(8, 8, (x, y) => 
  (x + y) % 2 === 0 ? 'black' : 'white'
);

// read a value
const colour = chessGrid.get(4, 5);

// initialise a grid from a Pipe2D
const source = imagePipe
	.crop(10, 10, 64, 64)
	.scale(.5)
	.rotateLeft();
const grid = Grid.from(source);
```

### Wrapping existing structures

Use Grid's interface and features over any read/write 2D structure:

```ts
const gameMap = [
	[0, 1, -1, 2],
	[1, 0, 1, 0],
	[-1, 1, 0, 2],
	[2, 0, 2, -1]
];

// create a *live view* Grid over gameMap
const grid = Grid.wrap(
	gameMap[0].length, // width
	gameMap.length, // height
	(x, y) => gameMap[y][x], // get
	(x, y, value) => gameMap[y][x] = value // set
);

// reading the grid = reading the source
gameMap[0][0] = 50;
console.log(grid.get(0, 0)); // 50
// writing to the grid = writing to the source
grid.set(3, 3, 100);
console.log(gameMap[3][3]); // 100
```

## Regions

Use `grid.region(x, y, w, h)` to define a subgrid. The subgrid is **zero-copy view** into the parent; changes to the subgrid affect the parent and vice-versa.

```ts
// game map with terrain
const world = Grid.solid(100, 100, "grass"); // Grid<string>

// add a lake
world.region(30, 30, 20, 20).fill("water");

// add mountains around the lake with a circular mask
const centre = world.cells.get(40, 40);
const mask = (x: number, y: number) => {
  const dist = Math.hypot(x - centre.x, y - centre.y);
  return dist > 12 && dist < 18; // mountain ring
};
world.fill("mountain", mask);

// get a view of just the interesting area
const lakeRegion = world.region(25, 25, 30, 30);

// do we want a distinct, self-contained copy of the region?
const lakeGrid = Grid.from(lakeRegion);
```

## Transformation Layers

`grid.map(read, write)` creates a **zero-copy view** that reads and writes the parent through the provided transformation functions.

```ts
const spriteMap = world.map(
	type => type + ".png",
	sprite => sprite.replace(/\..*/, '')
);

world.set(0, 0, "mountain"); // modify the parent
console.log(spriteMap.get(0, 0)); // read the transformed view: "mountain.png"
spriteMap.set(1, 0, "forest.png"); // modify the view
console.log(world.get(1, 0)); // read the parent: "forest"
```

For one-way read-mapping, use `grid.pipe` - a [Pipe2D](https://github.com/tiadrop/pipe2d) view into the grid's data.

```ts
// create a one-way, player-centred sprite map
const viewport = world.pipe
	.oob("mountain")
	.map(t => t + ".png")
	.crop(playerX - 5, playerY - 5, 10, 10);

// or get a list of locations of cells with mountains
const mountainCells = world.cells.toFlatArrayXY()
	.filter(cell => cell.value === "mountain")
	.map(cell => [cell.x, cell.y]);

// or get a live, renderable minimap
const colourMap = new Map(Object.entries({
	grass: "#0f0",
	water: "#00f",
	forest: "#080",
	mountain: "#a70"
}));
const minimap = world.pipe.map(colourMap).map(parseRGBA);

```

## Cell interface

`grid.cells` provides a Pipe2D, for convenient transformation, of Cell objects, each representing a live view into a grid location.

```ts
const topLeft = world.cells.get(0, 0);
console.log(topLeft.value); // "mountain"

topLeft.value = "forest"; // modifies the underlying data
console.log(spriteMap.get(0, 0)); // now "forest.png";

// navigate by offset
const adjacentCell = topLeft.look(1, 0);
console.log(adjacentCell?.x, adjacentCell?.y); // 1, 0
```

Cells provide methods for locational utilities such as pathfinding and visibility mapping.

Cells are unique to, owned by, and coordinated relative to the view that provided them. Their pathfinding and visibility mapping features are unaware of space outside of their view's bounds.

### (Everybody needs good) Neighbours

`cell.getNeighbours(includeDiagonals?)` returns an array of Cells:

```ts
// derive a display number for clicked cells in Minesweeper
const numOfAdjacentMines = clickedCell.getNeighbours(true)
	.filter(cell => cell.value.isMine)
	.length;
```

### Path finding
```ts
const costs = {
	grass: 1,
	water: Infinity,
	mountain: Infinity,
	forest: 2
};

const start = world.cells.get(5, 5);
const destination = world.cells.get(90, 90);
const path = start.findPath(
	destination, // or simply [90, 90]
	(cell) => costs[cell.value]
); // Cell<string>[]
```

### Visibility mapping

```ts
// createVisibilityMap(isClear);
const visibility = start.createVisibilityMap(
	cell => cell.value === "grass" // anything except grass blocks vision
);

// any 2d source, including visibility maps, can be used as a mask for paste/fill operations
// paste(source: Source2D<T>, mask?: Source2D<boolean>)
screenGrid.paste(spriteMap, 0, 0, visibility);
```

### Reusing path data

Use `cell.getPathMap(costFunc)` to create a Pipe2D of optimal paths from the parent cell. The grid space is explored once to produce an internal traversal map, and paths to individual cells are constructed from that data (and cached) when that pipe is queried.

```ts
const pathMap = start.getPathMap(c => costs[c.value]);

const pathToCentre = pathMap.get(50, 50);
const pathToCorner = pathMap.get(99, 99);
```

Unlike visibility maps, which are lazily evaluated according to the supplied `isClear` function *when the map is queried* (but can be easily cached with `visMap.withCache()`), path maps use a relatively expensive traversal map that's created *when the map is created*. This distinction is hinted through the `create*` vs `get*` naming.

## The storage layer

`Grid` itself is an interface for reading and writing 2D data. `GridBase` - a subclass of `Grid` - maintains the actual storage of such data.

Although the Grid factory methods (`Grid.solid<T>()`, `Grid.from<T>()`, `Grid.init<T>()`) belong to `Grid`, they return a `GridBase<T>`. `Grid.wrap<T>()` is an exception, returning `Grid<T>`, as it uses a storage layer provided by the user. The only API distinction is that `GridBase` provides a 'change' event, via `grid.on("change", handler)`.

We can perform batched updates, suppressing the 'change' event until a process concludes, with `grid.batchUpdate(callback)`.

## Save and load

Pipe2D makes it easy to save and restore grid data:

```ts
const saved = world.pipe.toFlatArrayXY(); // ["mountain", "forest", "grass", ...]

const restoredPipe = Pipe2D.fromFlatArrayXY(saved);
const restored = Grid.from(restoredPipe);
```