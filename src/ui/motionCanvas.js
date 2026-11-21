import { CONNECTIONS } from "../mediapipe/handTracker.js";

const COLORS = { Left: "#a7edbc", Right: "#f7cc83", Unknown: "#cbd5e1" };
const PALM = [0, 1, 5, 9, 13, 17];
const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

export function frameRect(width, height, aspect) {
  const w = Math.min(width, height * aspect);
  const h = Math.min(height, width / aspect);
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function handShape(ctx, points) {
  const a = points[5],
    b = points[17];
  const palmWidth = Math.hypot(a.x - b.x, a.y - b.y);
  const wristToPalm = Math.hypot(
    points[9].x - points[0].x,
    points[9].y - points[0].y,
  );
  const thickness = Math.max(
    2,
    Math.min(palmWidth * 0.22, wristToPalm * 0.33, 24),
  );
  ctx.lineWidth = thickness * 0.65;
  ctx.beginPath();
  for (const [i, joint] of PALM.entries()) {
    const { x, y } = points[joint];
    if (!i) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const [fingerIndex, finger] of FINGERS.entries()) {
    for (let i = 1; i < finger.length; i++) {
      ctx.lineWidth =
        thickness * (1.12 - (i - 1) * 0.15) * (fingerIndex === 4 ? 0.8 : 1);
      line(ctx, points[finger[i - 1]], points[finger[i]]);
    }
  }
}

export function drawMotion(canvas, hands, aspect, view) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rect = frameRect(canvas.width, canvas.height, aspect);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.lineCap = ctx.lineJoin = "round";
  // Positions are in the original camera view, including the position of one
  // hand relative to the other. This canvas never mirrors or recenters a hand.
  for (const hand of hands) {
    const points = hand.landmarks.map((p) => ({
      x: rect.x + p.x * rect.w,
      y: rect.y + p.y * rect.h,
    }));
    ctx.fillStyle = ctx.strokeStyle = COLORS[hand.handedness] ?? COLORS.Unknown;
    if (view === "shape") {
      handShape(ctx, points);
      continue;
    }
    ctx.lineWidth = 2;
    for (const [a, b] of CONNECTIONS) line(ctx, points[a], points[b]);
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.restore();
}
