/**
 * 动画预设摘自 pi-working-activity 1.9.0，保持原始帧和播放间隔。
 * 原作者 chimney；MIT License，详见 THIRD_PARTY_NOTICES.md。
 */
const TE = "\uFE0E";

// 帧间隔：在“不闪”和“不拖”之间取平衡，本次统一微调快约 10%
export const FRAME_PRESETS: Record<string, { frames: string[]; intervalMs: number }> = {
	// Claude Code 真实序列：· ✢ * ✶ ✻ ✽ 正放 + 倒放（官方源码确认）
	claude: {
		frames: ["·", `✢${TE}`, "*", `✶${TE}`, `✻${TE}`, `✽${TE}`, `✻${TE}`, `✶${TE}`, "*", `✢${TE}`],
		intervalMs: 150,
	},
	star2: { frames: [`✶${TE}`, `✸${TE}`, `✹${TE}`, `✺${TE}`, `✹${TE}`, `✷${TE}`], intervalMs: 140 },
	sand: {
		frames: ["⠁", "⠂", "⠄", "⡀", "⡈", "⡐", "⡠", "⣀", "⣁", "⣂", "⣄", "⣌", "⣔", "⣤", "⣥", "⣦", "⣮", "⣶", "⣷", "⣿", "⡿", "⠿", "⢟", "⠟", "⡛", "⠛", "⠫", "⢋", "⠋", "⠍", "⡉", "⠉", "⠑", "⠡", "⢁"],
		intervalMs: 120,
	},
	triangle: { frames: ["◢", "◣", "◤", "◥"], intervalMs: 180 },
	box: { frames: ["▖", "▘", "▝", "▗"], intervalMs: 180 },
	box2: { frames: ["▌", "▀", "▐", "▄"], intervalMs: 180 },
	corners: { frames: ["◰", "◳", "◲", "◱"], intervalMs: 190 },
	point: { frames: ["∙∙∙", "●∙∙", "∙●∙", "∙∙●", "∙∙∙"], intervalMs: 190 },
	layer: { frames: ["-", "=", "≡"], intervalMs: 220 },
	flip: { frames: ["_", "_", "_", "-", "`", "`", "'", "´", "-", "_", "_", "_"], intervalMs: 140 },
	aesthetic: {
		frames: ["▰▱▱▱▱▱▱", "▰▰▱▱▱▱▱", "▰▰▰▱▱▱▱", "▰▰▰▰▱▱▱", "▰▰▰▰▰▱▱", "▰▰▰▰▰▰▱", "▰▰▰▰▰▰▰", "▰▱▱▱▱▱▱"],
		intervalMs: 140,
	},
	hamburger: { frames: ["☱", "☲", "☴"], intervalMs: 220 },
	moon: { frames: ["◐", "◓", "◑", "◒"], intervalMs: 240 },
	// kimi-code MoonLoader 同款：8 帧 emoji 月相，120ms 一帧，比半圆版更丝滑
	// 不带 \uFE0E：保留彩色 emoji 渲染（Windows Terminal 等现代终端效果最佳）
	moon8: { frames: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"], intervalMs: 120 },
	// 鲸鱼喷水：🐳 固定，水柱升起（· → | → ║）再回落，顶珠 ° 模拟水花
	"whale-spout": {
		frames: ["🐳  ", "🐳° ", "🐳|°", "🐳║°", "🐳|°", "🐳° ", "🐳  "],
		intervalMs: 160,
	},
	// 鲸鱼转圈：🐳 + 环绕方向指示（逆时针转圈语义）
	"whale-spin": {
		frames: ["🐳→", "🐳↘", "🐳↓", "🐳↙", "🐳←", "🐳↖", "🐳↑", "🐳↗"],
		intervalMs: 150,
	},
	comet: {
		frames: ["●    ", " ●   ", "  ●  ", "   ● ", "    ●", "   ● ", "  ●  ", " ●   "],
		intervalMs: 160,
	},
	breathe: { frames: ["▁", "▃", "▅", "▇", "▅", "▃"], intervalMs: 210 },
	dots: { frames: ["⣾", "⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽"], intervalMs: 140 },
	arrow: { frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"], intervalMs: 160 },
	spark: { frames: ["·", "∘", "°", "✧", "°", "∘"], intervalMs: 240 },
	bar: { frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█", "▉", "▊", "▋", "▌", "▍", "▎"], intervalMs: 120 },
	braille: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"], intervalMs: 120 },
	arc: { frames: ["◜", "◠", "◝", "◞", "◡", "◟"], intervalMs: 160 },
	circle: { frames: ["◴", "◷", "◶", "◵"], intervalMs: 190 },
	grow: { frames: [".", "o", "O", "0", "O", "o"], intervalMs: 210 },
	noise: { frames: ["▓", "▒", "░", "▒"], intervalMs: 160 },
	bounce: { frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"], intervalMs: 140 },
	bar2: {
		frames: [
			"[    ]", "[=   ]", "[==  ]", "[=== ]", "[ ===]",
			"[  ==]", "[   =]", "[    ]", "[   =]", "[  ==]",
			"[ ===]", "[=== ]", "[==  ]", "[=   ]",
		],
		intervalMs: 140,
	},
	dqpb: { frames: ["d", "q", "p", "b"], intervalMs: 210 },
	toggle: { frames: ["⊶", "⊷"], intervalMs: 300 },
};
