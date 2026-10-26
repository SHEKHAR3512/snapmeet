"""Generates tests/fixtures/synthetic-figure.y4m: a drawn head-and-shoulders figure in a
room, swaying slightly. Synthetic (no real person), used as the fake camera in e2e tests."""
import math, os, sys
W, H, N = 320, 180, 40
out = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures', 'synthetic-figure.y4m')

def rgb2yuv(r, g, b):
    y = 0.257 * r + 0.504 * g + 0.098 * b + 16
    u = -0.148 * r - 0.291 * g + 0.439 * b + 128
    v = 0.439 * r - 0.368 * g - 0.071 * b + 128
    return int(y), int(u), int(v)

def pixel(x, y, dx):
    cx = 160 + dx
    # skin-toned face with darker hair, neck, shirt; simple shading
    if (x - cx) ** 2 / 26 ** 2 + (y - 66) ** 2 / 32 ** 2 < 1:
        if y < 50 and (x - cx) ** 2 / 28 ** 2 + (y - 60) ** 2 / 34 ** 2 < 1:
            return (52, 36, 28)
        shade = 1 - 0.25 * abs(x - cx) / 26
        return (int(222 * shade), int(176 * shade), int(140 * shade))
    if 92 < y < 112 and abs(x - cx) < 10:
        return (200, 158, 125)
    if y >= 104 and ((x - cx) / 70) ** 2 + ((y - 190) / 92) ** 2 < 1:
        return (48, 86, 140)
    # room
    if 30 < x < 90 and 30 < y < 75:
        return (190, 160, 120)
    return (int(150 + y * 0.2), int(165 + y * 0.15), int(180 + y * 0.1))

with open(out, 'wb') as f:
    f.write(f'YUV4MPEG2 W{W} H{H} F20:1 Ip A1:1 C420jpeg\n'.encode())
    for i in range(N):
        dx = int(4 * math.sin(i / N * 2 * math.pi))
        Y = bytearray(W * H); U = bytearray((W // 2) * (H // 2)); V = bytearray((W // 2) * (H // 2))
        for y in range(H):
            for x in range(W):
                yy, uu, vv = rgb2yuv(*pixel(x, y, dx))
                Y[y * W + x] = max(0, min(255, yy))
                if x % 2 == 0 and y % 2 == 0:
                    j = (y // 2) * (W // 2) + x // 2
                    U[j] = max(0, min(255, uu)); V[j] = max(0, min(255, vv))
        f.write(b'FRAME\n'); f.write(Y); f.write(U); f.write(V)
print('wrote', out)
