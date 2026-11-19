(function () {
  'use strict';

  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const tileGap = 0.07;
  const markerRadius = 0.7;
  const markerGap = 0.24;
  const laneClearance = 2.15;
  const padding = 12;

  function oriented(tile, dx, dy, x, y) {
    const backwards = dx < 0 || dy < 0;
    const alongVertical = dy !== 0;
    return {
      tile,
      a: backwards ? tile.to : tile.from,
      b: backwards ? tile.from : tile.to,
      vertical: tile.a === tile.b ? !alongVertical : alongVertical,
      x,
      y
    };
  }

  function pieceBounds(piece) {
    const radiusX = piece.vertical ? 0.5 : 1;
    const radiusY = piece.vertical ? 1 : 0.5;
    return [piece.x - radiusX, piece.y - radiusY, piece.x + radiusX, piece.y + radiusY];
  }

  function markerBounds({ x, y }) {
    return [x - markerRadius, y - markerRadius, x + markerRadius, y + markerRadius];
  }

  function union(a, b) {
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  }

  function boundsFor(pieces, tips, initialBounds) {
    const withPieces = pieces.reduce((bounds, piece) => union(bounds, pieceBounds(piece)), initialBounds);
    return tips.reduce((bounds, tip) => union(bounds, markerBounds(tip)), withPieces);
  }

  function straight(root, board, ends) {
    const pieces = [];
    const tips = [];
    for (const { side, pip } of ends) {
      const [dx, dy] = directions[side];
      const vertical = dy !== 0;
      let distance = vertical === root.vertical ? 1 : 0.5;
      for (const tile of board.arms[side]) {
        const radius = tile.a === tile.b ? 0.5 : 1;
        const center = distance + tileGap + radius;
        pieces.push(oriented(tile, dx, dy, center * dx, center * dy));
        distance = center + radius;
      }
      const markerDistance = distance + markerRadius + markerGap;
      tips.push({ side, pip, x: markerDistance * dx, y: markerDistance * dy });
    }
    return { pieces, tips, bounds: boundsFor(pieces, tips, pieceBounds(root)) };
  }

  function intersects(a, b) {
    return a[0] < b[2] - 1e-7 && a[2] > b[0] + 1e-7 &&
      a[1] < b[3] - 1e-7 && a[3] > b[1] + 1e-7;
  }

  // In the arm's local coordinates x points away from the house and y into the
  // assigned quadrant. At a bend the next stone touches the free half from the side.
  function connect(previous, tile, dx, dy) {
    const [minX, minY, maxX, maxY] = previous.bounds;
    const fromX = dx < 0 ? minX : dx > 0 ? maxX : previous.freeX;
    const fromY = dy > 0 ? maxY : previous.freeY;
    const radius = tile ? (tile.a === tile.b ? 0.5 : 1) : markerRadius;
    const distance = radius + (tile ? tileGap : markerGap);
    const x = fromX + dx * distance;
    const y = fromY + dy * distance;
    if (!tile) return { x, y, bounds: markerBounds({ x, y }) };

    const piece = oriented(tile, dx, dy, x, y);
    const half = tile.a === tile.b ? 0 : 0.5;
    return {
      ...piece, bounds: pieceBounds(piece), freeX: x + dx * half, freeY: y + dy * half
    };
  }

  function routeArm(root, tiles, end, maxDepth, bend) {
    const [dx, dy] = directions[end.side];
    const turnX = -dy * bend;
    const turnY = dx * bend;
    const rootRadius = (dy !== 0) === root.vertical ? 1 : 0.5;
    const occupied = [[-rootRadius, -(1.5 - rootRadius), rootRadius, 1.5 - rootRadius]];
    let tipAnchor = { freeX: 0, freeY: 0, bounds: occupied[0] };
    let sign = 1;
    let laneY = 0;
    let atBend = false;
    let folds = 0;
    const pieces = [];

    function candidate(tile, localX, localY) {
      const placed = connect(tipAnchor, tile, localX, localY);
      if (placed.bounds[0] < (localY || folds ? 1.02 : rootRadius) - 1e-7 ||
          placed.bounds[2] > maxDepth || occupied.some(bounds => intersects(bounds, placed.bounds))) return null;
      return placed;
    }

    function worldPoint(x, y) {
      return [x * dx + y * turnX, x * dy + y * turnY];
    }

    for (const tile of tiles) {
      let localX = sign;
      let localY = 0;
      let placed = null;
      if (!atBend || tipAnchor.freeY - laneY >= laneClearance) {
        placed = candidate(tile, localX, localY);
      }
      if (placed && atBend) {
        laneY = placed.y;
        atBend = false;
      }
      if (!placed) {
        if (!pieces.length) return null;
        localX = 0;
        localY = 1;
        placed = candidate(tile, localX, localY);
        if (!placed) return null;
        if (!atBend) {
          sign = -sign;
          folds++;
          atBend = true;
        }
      }

      const [x, y] = worldPoint(placed.x, placed.y);
      const [worldDX, worldDY] = worldPoint(localX, localY);
      pieces.push(oriented(tile, worldDX, worldDY, x, y));
      occupied.push(placed.bounds);
      tipAnchor = placed;
    }

    const straightTip = connect(tipAnchor, null, atBend ? 0 : sign, atBend ? 1 : 0);
    const canUseStraightTip = (!folds || straightTip.bounds[0] >= 1.02) &&
      !occupied.some(bounds => intersects(bounds, straightTip.bounds));
    const tipPosition = canUseStraightTip ? straightTip : candidate(null, 0, 1);
    if (!tipPosition) return null;
    const [x, y] = worldPoint(tipPosition.x, tipPosition.y);
    const tip = { ...end, x, y };
    return { pieces, tip, folds, bounds: boundsFor(pieces, [tip], pieceBounds(root)) };
  }

  function unitFor(bounds, width, height, maxUnit) {
    return Math.min(maxUnit, width / (bounds[2] - bounds[0]), height / (bounds[3] - bounds[1]));
  }

  function folded(root, board, ends, width, height, maxUnit) {
    let best = null;
    for (const bend of [1, -1]) {
      const options = ends.map(end => {
        const tiles = board.arms[end.side];
        const candidates = [];
        for (let depth = 3; depth <= tiles.length * 2.1 + 4; depth++) {
          const arm = routeArm(root, tiles, end, depth, bend);
          if (!arm) continue;
          const contained = (inner, outer) => inner[0] >= outer[0] && inner[1] >= outer[1] &&
            inner[2] <= outer[2] && inner[3] <= outer[3];
          if (candidates.some(option => option.folds <= arm.folds && contained(option.bounds, arm.bounds))) continue;
          candidates.push(arm);
        }
        return candidates;
      });
      const arms = [];
      function visit(bounds, folds) {
        const unit = unitFor(bounds, width, height, maxUnit);
        if (best && (unit < best.unit - 0.01 || (unit <= best.unit + 0.01 && folds >= best.folds))) return;
        if (arms.length === options.length) {
          best = { arms: arms.slice(), bounds, unit, folds };
          return;
        }
        for (const arm of options[arms.length]) {
          arms.push(arm);
          visit(union(bounds, arm.bounds), folds + arm.folds);
          arms.pop();
        }
      }
      visit(pieceBounds(root), 0);
    }
    if (!best) return null;
    return {
      pieces: best.arms.flatMap(arm => arm.pieces),
      tips: best.arms.map(arm => arm.tip),
      bounds: best.bounds,
      unit: best.unit
    };
  }

  function fit(board, ends, width, height) {
    if (!board.root) return { unit: 0, pieces: [], tips: [] };
    const maxUnit = width < 500 ? 31 : 40;
    const availableWidth = Math.max(0, width - padding * 2);
    const availableHeight = Math.max(0, height - padding * 2);
    const root = { tile: board.root, a: board.root.a, b: board.root.b, vertical: board.spinner, x: 0, y: 0 };
    let layout = straight(root, board, ends);
    let unit = unitFor(layout.bounds, availableWidth, availableHeight, maxUnit);
    // Keep the physical cross on larger tables as long as it remains readable.
    const straightMinimum = width >= 900 ? 23 : 24;
    if (unit < straightMinimum) {
      const candidate = folded(root, board, ends, availableWidth, availableHeight, maxUnit);
      if (candidate && candidate.unit > unit + 2) {
        layout = candidate;
        unit = candidate.unit;
      }
    }
    const [minX, minY, maxX, maxY] = layout.bounds;
    const offsetX = (width - unit * (minX + maxX)) / 2;
    const offsetY = (height - unit * (minY + maxY)) / 2;
    const mapX = x => x * unit + offsetX;
    const mapY = y => y * unit + offsetY;
    const mapPoint = point => ({ ...point, x: mapX(point.x), y: mapY(point.y) });

    return {
      unit,
      pieces: [root, ...layout.pieces].map(mapPoint),
      tips: layout.tips.map(mapPoint)
    };
  }

  const api = { fit };
  if (typeof module === 'object' && module.exports) module.exports = api;
  globalThis.DominoBoardLayout = api;
})();
