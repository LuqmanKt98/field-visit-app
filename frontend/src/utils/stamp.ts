/**
 * Burns a direction + timestamp stamp into the bottom-left corner of a canvas
 * that already has a video frame drawn on it. Used for both photo capture
 * (drawn once) and video recording (redrawn every frame), so the stamp is
 * permanently part of the exported media, not just an on-screen overlay.
 */
export function drawStamp(ctx: CanvasRenderingContext2D, width: number, height: number, cardinal: string | null, when: Date): void {
    const line1 = `Direction: ${cardinal ?? 'N/A'}`;
    const line2 = when.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });

    const fontSize = Math.max(16, Math.round(width * 0.028));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const padding = fontSize * 0.6;
    const textWidth = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
    const boxWidth = textWidth + padding * 2;
    const boxHeight = fontSize * 2.6 + padding;
    const boxX = padding;
    const boxY = height - boxHeight - padding;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(line1, boxX + padding * 0.5, boxY + padding * 0.5);
    ctx.fillText(line2, boxX + padding * 0.5, boxY + padding * 0.5 + fontSize * 1.3);
}
