// Civil War RTS - Isoline Renderer Utilities

export class IsolineRenderer {
    constructor(ctx) {
        this.ctx = ctx;
    }

    renderIsolines(isolines, scaleX = 1, scaleY = 1, options = {}) {
        const {
            strokeStyle = '#8b7355',
            lineWidth = 1,
            alpha = 0.5,
            labelInterval = 3
        } = options;

        this.ctx.strokeStyle = strokeStyle;
        this.ctx.lineWidth = lineWidth;
        this.ctx.globalAlpha = alpha;

        for (let i = 0; i < isolines.length; i++) {
            const isoline = isolines[i];
            if (isoline.points.length < 2) continue;

            this.ctx.beginPath();
            const first = isoline.points[0];
            this.ctx.moveTo(first.x * scaleX, first.y * scaleY);

            for (let j = 1; j < isoline.points.length; j++) {
                const p = isoline.points[j];
                this.ctx.lineTo(p.x * scaleX, p.y * scaleY);
            }

            this.ctx.stroke();

            // Draw elevation label at intervals
            if (i % labelInterval === 0 && isoline.points.length > 0) {
                const midPoint = isoline.points[Math.floor(isoline.points.length / 2)];
                this.ctx.fillStyle = strokeStyle;
                this.ctx.font = '8px Georgia';
                this.ctx.globalAlpha = 0.7;
                this.ctx.fillText(
                    isoline.elevation.toString(),
                    midPoint.x * scaleX + 2,
                    midPoint.y * scaleY - 2
                );
            }
        }

        this.ctx.globalAlpha = 1;
    }

    renderElevationHeatmap(elevationData, width, height, canvasWidth, canvasHeight) {
        const imageData = this.ctx.createImageData(canvasWidth, canvasHeight);
        const data = imageData.data;

        for (let y = 0; y < canvasHeight; y++) {
            for (let x = 0; x < canvasWidth; x++) {
                const mapX = Math.floor(x * width / canvasWidth);
                const mapY = Math.floor(y * height / canvasHeight);
                const elevation = elevationData[mapY * width + mapX] || 0;

                // Parchment-style coloring
                const baseR = 244, baseG = 228, baseB = 188;
                const shade = elevation / 10;

                const i = (y * canvasWidth + x) * 4;
                data[i] = Math.max(0, baseR - shade * 30);
                data[i + 1] = Math.max(0, baseG - shade * 40);
                data[i + 2] = Math.max(0, baseB - shade * 50);
                data[i + 3] = 255;
            }
        }

        this.ctx.putImageData(imageData, 0, 0);
    }

    renderGradientShading(elevationData, width, height, canvasWidth, canvasHeight) {
        // Calculate gradient magnitude for hillshade effect
        const imageData = this.ctx.createImageData(canvasWidth, canvasHeight);
        const data = imageData.data;

        // Light direction (from top-left)
        const lightX = -1;
        const lightY = -1;
        const lightZ = 2;
        const lightMag = Math.sqrt(lightX * lightX + lightY * lightY + lightZ * lightZ);

        for (let y = 0; y < canvasHeight; y++) {
            for (let x = 0; x < canvasWidth; x++) {
                const mapX = Math.floor(x * width / canvasWidth);
                const mapY = Math.floor(y * height / canvasHeight);

                // Calculate gradient
                const left = mapX > 0 ? elevationData[mapY * width + mapX - 1] : elevationData[mapY * width + mapX];
                const right = mapX < width - 1 ? elevationData[mapY * width + mapX + 1] : elevationData[mapY * width + mapX];
                const up = mapY > 0 ? elevationData[(mapY - 1) * width + mapX] : elevationData[mapY * width + mapX];
                const down = mapY < height - 1 ? elevationData[(mapY + 1) * width + mapX] : elevationData[mapY * width + mapX];

                const dx = (right - left) / 2;
                const dy = (down - up) / 2;

                // Normal vector
                const nx = -dx;
                const ny = -dy;
                const nz = 1;
                const nMag = Math.sqrt(nx * nx + ny * ny + nz * nz);

                // Dot product for shading
                const shade = (nx * lightX + ny * lightY + nz * lightZ) / (nMag * lightMag);
                const brightness = Math.max(0.3, Math.min(1, (shade + 1) / 2));

                const elevation = elevationData[mapY * width + mapX] || 0;
                const baseR = 244, baseG = 228, baseB = 188;
                const elevShade = elevation / 10;

                const i = (y * canvasWidth + x) * 4;
                data[i] = Math.max(0, (baseR - elevShade * 30) * brightness);
                data[i + 1] = Math.max(0, (baseG - elevShade * 40) * brightness);
                data[i + 2] = Math.max(0, (baseB - elevShade * 50) * brightness);
                data[i + 3] = 255;
            }
        }

        this.ctx.putImageData(imageData, 0, 0);
    }
}
