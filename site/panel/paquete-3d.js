const referenceSize = [25, 26, 22];
const motion = matchMedia('(prefers-reduced-motion: reduce)');

function surface(context, points, fill, outline) {
  context.beginPath();
  context.moveTo(...points[0]);
  for (const point of points.slice(1)) context.lineTo(...point);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  if (outline) {
    context.strokeStyle = outline;
    context.lineWidth = 1;
    context.stroke();
  }
}

function measureLine(context, from, to) {
  context.beginPath();
  context.moveTo(...from);
  context.lineTo(...to);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const dx = Math.sin(angle) * 4;
  const dy = Math.cos(angle) * 4;
  for (const [x, y] of [from, to]) {
    context.moveTo(x - dx, y + dy);
    context.lineTo(x + dx, y - dy);
  }
  context.strokeStyle = '#628374';
  context.lineWidth = 0.85;
  context.stroke();
}

export function createPackagePreview(canvas, { compact = false } = {}) {
  const context = canvas.getContext('2d');
  if (!context) return () => {};
  let displayed = referenceSize;
  let target = referenceSize;
  let animation;

  function draw() {
    const { width: viewWidth, height: viewHeight } = canvas.getBoundingClientRect();
    if (!viewWidth || !viewHeight) return;
    const ratio = Math.min(devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(viewWidth * ratio);
    const pixelHeight = Math.round(viewHeight * ratio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, viewWidth, viewHeight);

    const [height, width, length] = displayed;
    const cos = 0.87;
    const sin = 0.47;
    const spanX = (width + length) * cos;
    const spanY = (width + length) * sin + height;
    const scale = Math.min(viewWidth / (compact ? 62 : 113), (viewWidth * 0.72) / spanX, (viewHeight * 0.69) / spanY);
    const cx = viewWidth / 2 - (width - length) * cos * scale / 2;
    const cy = viewHeight * 0.43 - ((width + length) * sin - height) * scale / 2;
    const point = (x, y, z = 0) => [cx + (x - y) * cos * scale, cy + ((x + y) * sin - z) * scale];
    const shadowY = point(width / 2, length / 2)[1] + (compact ? 4 : 13);
    context.save();
    context.translate(viewWidth / 2, shadowY);
    context.scale(Math.max(compact ? 9 : 25, spanX * scale * 0.64), Math.max(compact ? 3 : 9, spanX * scale * 0.16));
    const shadow = context.createRadialGradient(0, 0, 0.12, 0, 0, 1);
    shadow.addColorStop(0, '#22392c48');
    shadow.addColorStop(1, '#22392c00');
    context.fillStyle = shadow;
    context.fillRect(-1, -1, 2, 2);
    context.restore();

    const top = [point(0, 0, height), point(width, 0, height), point(width, length, height), point(0, length, height)];
    const front = [top[3], top[2], point(width, length), point(0, length)];
    const side = [top[2], top[1], point(width, 0), point(width, length)];
    const face = (light, dark, points) => {
      const vertical = points.map(point => point[1]);
      const gradient = context.createLinearGradient(0, Math.min(...vertical), 0, Math.max(...vertical));
      gradient.addColorStop(0, light);
      gradient.addColorStop(1, dark);
      surface(context, points, gradient, '#956f49');
    };
    face('#c49b6f', '#aa8055', front);
    face('#a98156', '#90673f', side);
    face('#e0c6a1', '#caa776', top);

    const tapeLeft = width * 0.43;
    const tapeRight = width * 0.57;
    surface(context, [point(tapeLeft, 0, height), point(tapeRight, 0, height),
      point(tapeRight, length, height), point(tapeLeft, length, height)], '#d6df80');
    surface(context, [point(tapeLeft, length, height), point(tapeRight, length, height),
      point(tapeRight, length, height * 0.72), point(tapeLeft, length, height * 0.72)], '#a9ad54');
    if (height * scale > 20 && width * scale > 24) {
      surface(context, [point(width * 0.14, length, height * 0.62), point(width * 0.33, length, height * 0.62),
        point(width * 0.33, length, height * 0.35), point(width * 0.14, length, height * 0.35)], '#eed9b6');
    }

    const anchor = point(width, length);
    const left = point(0, length);
    const right = point(width, 0);
    const raised = point(width, 0, height);
    const margin = compact ? 4 : 11;
    measureLine(context, [left[0] - 1, left[1] + margin], [anchor[0], anchor[1] + margin]);
    measureLine(context, [anchor[0], anchor[1] + margin], [right[0] + 1, right[1] + margin]);
    measureLine(context, [right[0] + margin, right[1]], [raised[0] + margin, raised[1]]);
  }

  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  function update(dimensions) {
    const proposed = dimensions?.slice(0, 3).map((value, index) => Number.isFinite(value) && value > 0 ? value : referenceSize[index]);
    const next = proposed ?? referenceSize;
    if (next.every((value, index) => value === target[index])) return;
    target = next;
    cancelAnimationFrame(animation);
    if (motion.matches) {
      displayed = next;
      draw();
      return;
    }
    const start = displayed;
    const started = performance.now();
    function render(now) {
      const progress = Math.min(1, (now - started) / 180);
      const eased = 1 - (1 - progress) ** 3;
      displayed = start.map((value, index) => value + (next[index] - value) * eased);
      draw();
      if (progress < 1) animation = requestAnimationFrame(render);
    }
    animation = requestAnimationFrame(render);
  }
  update.dispose = () => {
    observer.disconnect();
    cancelAnimationFrame(animation);
  };
  return update;
}
