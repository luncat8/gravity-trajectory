#!/usr/bin/env python3
"""Project-aware Tk gallery adapted from the arc-steam prompt pack.

Prompt cards, image viewer, video-player links, seed variations, delete/undo,
workflow selection and batch logs. launch.py shares the queue engine and state.
Run gallery.py [--project project.json]; Pillow is optional.

The prompt list is painted, not rebuilt. Images and queue counts arrive from a
worker thread every second, and destroying every card for one new thumbnail
blinks the whole list and drops the checkbox focus. A card therefore learns its
files through set_images() and rewrites only the widgets whose text changed; the
cards are rebuilt only when the card set itself changes (filter, prompt file,
workflow, resize, view mode).
"""

import json
import math
import os
import queue
import random
import subprocess
import sys
import threading
import time
import tkinter.font as tkfont
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, filedialog
from types import SimpleNamespace

sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
	sys.path.insert(0, str(HERE))
import launch  # parser / patcher / comfy api shared with the CLI

try:
	from PIL import Image, ImageTk
	PIL_OK = True
except Exception:
	PIL_OK = False

OUTPUT_DIR = launch.OUTPUT_DIR
TRASH_DIR = OUTPUT_DIR / ".trash"
THUMB_W, THUMB_H = 170, 120
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm"}
VIDEO_EXTS = (".mp4", ".webm")
CARD_PAD = 30  # card inner width minus its horizontal padding, for columns
# a file younger than this may still be filling: the scan skips it
SETTLE_S = 2.0

# ------------------------------------------------------------------ palette
BG = "#1b1d21"        # window
PANEL = "#22252b"     # sidebar / toolbar
CARD = "#262a31"      # enabled card
CARD_OFF = "#1c1e22"  # disabled card (visibly darker)
CARD_ON = "#2f3644"   # selected card
EDGE = "#31353e"
FG = "#e8e9ec"
DIM = "#a3a9b6"
FAINT = "#858b99"     # dim but still readable
ACCENT = "#7aa2f7"
ACCENT_TXT = "#0e1116"
BTN = "#2e323b"
BTN_ACTIVE = "#3a3f4b"
GOOD = "#9ece6a"
BAD = "#f7768e"
WAIT = "#e0af68"
SELECT = "#16181c"
CHIP = {
	"splash": ("#2d4f8f", "#dbe4ff"),
	"background": ("#2d5f57", "#d2efe9"),
	"art": ("#6d4f2d", "#ffe3c2"),
}

DEFAULTS = {
	"server": launch.DEFAULT_SERVER,
	"variations": 1,
	"steps": "",        # "" = workflow default
	"cfg": "",          # "" = workflow default
	"negative": launch.DEFAULT_NEGATIVE,
	"slg": True,
}


split_name = launch.split_name  # naming lives next to the writer, launch.py
seed_of = launch.seed_of


def short_seed(seed):
	return f"...{seed % 10_000_000:07d}"


class Tooltip:
	"""Tiny delayed tooltip; text can be a str or a zero-arg callable."""

	def __init__(self, widget, text):
		self.widget, self.text = widget, text
		self.tip = None
		self._after = None
		widget.bind("<Enter>", self._enter, add="+")
		widget.bind("<Leave>", self._leave, add="+")

	def _enter(self, _e):
		self._after = self.widget.after(500, self._show)

	def _leave(self, _e):
		if self._after:
			self.widget.after_cancel(self._after)
			self._after = None
		self._hide()

	def _show(self):
		self._after = None
		if self.tip or not self.widget.winfo_exists():
			return
		text = self.text() if callable(self.text) else self.text
		if not text:
			return
		x = self.widget.winfo_rootx() + self.widget.winfo_width() + 8
		y = self.widget.winfo_rooty() + 10
		self.tip = tw = tk.Toplevel(self.widget)
		tw.wm_overrideredirect(True)
		tw.wm_geometry(f"+{x}+{y}")
		tk.Label(tw, text=text, bg=BTN_ACTIVE, fg=FG, justify="left",
				 padx=8, pady=4, font=(self.font_family, 8)).pack()

	def _hide(self):
		if self.tip:
			self.tip.destroy()
			self.tip = None

	@property
	def font_family(self):
		try:
			return tkfont.nametofont("TkDefaultFont").actual("family")
		except Exception:
			return ""


class PromptCard(tk.Frame):
	"""One prompt: caption + thumbnails + queue/delete/enable controls."""

	def __init__(self, parent, app, key):
		self.app, self.key = app, key
		self.job = job = app.jobs[key]
		self.files = ()       # painted by set_images
		self.cells = {}       # path -> (cell frame, photo widget)
		self.pending = -1     # -1: counts not painted yet
		self.enabled = app.job_enabled(key) and app.md_enabled(app.job_md[key])
		bg = self.bg = CARD if self.enabled else CARD_OFF
		super().__init__(parent, bg=bg, highlightthickness=1,
						 highlightbackground=EDGE, highlightcolor=EDGE,
						 padx=12, pady=8)
		self.pack(fill="x", padx=10, pady=(0, 10))
		F = app.F

		# ---- header: checkbox (carries the slug) · category chip · counts
		head = tk.Frame(self, bg=bg)
		head.pack(fill="x")
		self.enable_var = tk.BooleanVar(value=app.job_enabled(key))
		# the indicator is the mode-0 selectcolor rectangle beside the label, so
		# a toggle writes the variable only: configure() on a checkbutton
		# recreates those parts and loses focus for a one-pixel change
		chk = self.chk = tk.Checkbutton(
			head, variable=self.enable_var, text=job["slug"], command=self._toggle,
			bg=bg, fg=FG, selectcolor=SELECT, activebackground=bg,
			activeforeground=FG, bd=0, highlightthickness=0, anchor="w",
			font=F(11, True))
		chk.pack(side="left")
		Tooltip(chk, "include this prompt in batch runs (launch.py reads it too)")
		cbg, cfg_ = CHIP.get(job["category"], (BTN_ACTIVE, DIM))
		tk.Label(head, text=job["category"], bg=cbg, fg=cfg_, padx=7,
				 pady=1, font=F(8, True)).pack(side="left", padx=(8, 0))
		self.off_lbl = tk.Label(head, text="off", bg=BAD, fg=SELECT, padx=6,
								pady=1, font=F(8, True))
		self.pending_lbl = tk.Label(head, text="", bg=bg, fg=WAIT, font=F(9))
		self.pending_lbl.pack(side="right")
		self.count_lbl = tk.Label(head, text="", bg=bg, fg=FAINT, font=F(9))
		self.count_lbl.pack(side="right")

		# ---- caption
		self.caption_lbl = tk.Label(self, text=job["caption"], justify="left", bg=bg,
									fg=FG if self.enabled else DIM,
									wraplength=max(240, app.card_w - 64), font=F(9))
		self.caption_lbl.pack(fill="x", pady=(4, 2))

		# ---- meta line
		self.meta_lbl = tk.Label(
			self, text=(f"{job['aspect_ratio']}  ·  {job['megapixels']} MP"
						f"  ·  target {job['filename']}"),
			bg=bg, fg=FAINT, font=F(8))
		self.meta_lbl.pack(anchor="w")

		# ---- thumbnails
		self.thumb_box = tk.Frame(self, bg=bg)
		self.thumb_box.pack(fill="x", pady=(6, 4))
		self.empty_lbl = tk.Label(self.thumb_box, bg=bg, fg=FAINT, font=F(9),
			text="no images yet - queue one below, or Run batch")

		# ---- footer buttons
		foot = tk.Frame(self, bg=bg)
		foot.pack(fill="x")
		self.queue_btn = app.mkbtn(foot, "Queue variations", self._queue, primary=True)
		self.queue_btn.pack(side="left")
		Tooltip(self.queue_btn,
				"queue N fresh jobs (random seeds, N from the toolbar)\n"
				"finished images drop into this card automatically")
		app.mkbtn(foot, "Copy caption", lambda: app.copy_caption(key)).pack(
			side="left", padx=(6, 0))
		app.mkbtn(foot, "Copy path", self._copy_path).pack(side="right", padx=(6, 0))
		self._paint_enable()

	# ---------------------------------------------------------------- helpers
	def _toggle(self):
		self.app.toggle_job(self.key, self.enable_var.get())

	def _queue(self):
		self.app.enqueue_variations(self.key)

	def _copy_path(self):
		path = OUTPUT_DIR / self.job["filename"]
		self.app.clipboard_clear()
		self.app.clipboard_append(str(path))
		self.app.status(f"copied {path}")

	# ------------------------------------------------------------ enable paint
	def _paint_enable(self):
		"""What a toggle changes, written only to the nodes it changes."""
		if self.enabled:
			self.off_lbl.pack_forget()
		elif not self.off_lbl.winfo_ismapped():
			self.off_lbl.pack(side="left", padx=6)
		self.queue_btn.configure(state="normal" if self.enabled else "disabled")

	def set_edge(self, colour):
		if self.cget("highlightbackground") != colour:
			self.configure(highlightbackground=colour)

	def paint_bg(self, bg):
		"""Card background follows the enabled and selected state."""
		if bg == self.bg:
			return
		self.bg = bg
		was = self.caption_lbl.cget("bg")
		self.configure(bg=bg)
		for child in self.winfo_children():
			if isinstance(child, tk.Frame):
				child.configure(bg=bg)
		for name in ("chk", "caption_lbl", "meta_lbl", "pending_lbl",
					 "count_lbl", "empty_lbl"):
			getattr(self, name).configure(bg=bg)
		self.chk.configure(activebackground=bg)
		# thumbnails keep their own bg: repaint only the cells that own a photo
		for cell, _lbl in self.cells.values():
			cell.configure(bg=bg)
			for child in cell.winfo_children():
				if child.cget("bg") == was:
					child.configure(bg=bg)

	# -------------------------------------------------------------- image paint
	def set_images(self, files, pending):
		"""Repaint for a new file list; cards are reused, never rebuilt.

		A path keeps its cell across a repaint, so a finished render adds one
		thumbnail instead of replacing the row, and the Tk images stay cached.
		"""
		files = tuple(files)
		if files == self.files:
			self.set_pending(pending)
			return
		for path in set(self.files) - set(files):
			cell = self.cells.pop(path, None)
			if cell is not None:
				cell[0].destroy()
		self.files = files
		cols = self.app.columns()
		for index, path in enumerate(files):
			cell = self.cells.get(path)
			if cell is None:
				cell = self._add_thumb(path)
				self.cells[path] = cell
			cell[0].grid_configure(row=index // cols, column=index % cols,
								   padx=5, pady=5, sticky="w")
		if files:
			self.empty_lbl.pack_forget()
		elif not self.empty_lbl.winfo_ismapped():
			self.empty_lbl.pack(anchor="w")
		self.set_pending(pending)

	def _add_thumb(self, path):
		app, bg = self.app, self.bg
		cell = tk.Frame(self.thumb_box, bg=bg)
		photo = app.thumb_photo(path)
		if photo is None:
			lbl = tk.Label(cell, text="?  (preview not supported)", bg=EDGE,
						   fg=DIM, width=22, height=6, font=app.F(8))
			lbl.grid(sticky="w")
			return (cell, lbl)
		lbl = tk.Label(cell, image=photo, bg=bg, cursor="hand2")
		lbl.grid(sticky="w")
		seed = seed_of(path)
		tk.Label(cell, text=("seed " + short_seed(seed)) if seed
				 else "base (from batch)", bg=bg, fg=FAINT,
				 font=app.F(7)).grid(sticky="w")

		def tip_text():
			try:
				st = path.stat()
				when = time.strftime("%Y-%m-%d %H:%M", time.localtime(st.st_mtime))
				size = st.st_size // 1024
			except OSError:
				return path.name
			return (f"{path.name}\n"
					f"seed {seed if seed is not None else '-'}  ·  {size} KB\n{when}")

		Tooltip(lbl, tip_text)
		lbl.bind("<Button-1>", lambda e, p=path: app.open_viewer(self.key, p))
		x = tk.Button(cell, text="\u00d7", command=lambda p=path: app.delete_image(p),
					  bg="#3a2026", fg=BAD, activebackground=BAD,
					  activeforeground=BG, bd=0, padx=3, font=app.F(8, True),
					  cursor="hand2")
		x.place(in_=cell, relx=1.0, rely=0.0, x=-4, y=-4, anchor="ne")
		Tooltip(x, "delete this image (Ctrl+Z to undo)")
		return (cell, lbl)

	def set_pending(self, pending):
		if pending == self.pending:
			return
		self.pending = pending
		text = f"rendering {pending}..." if pending else ""
		if self.pending_lbl.cget("text") != text:
			self.pending_lbl.configure(text=text)

	def set_counts(self):
		text = f"{len(self.files)} image{'s' if len(self.files) != 1 else ''}"
		if self.count_lbl.cget("text") != text:
			self.count_lbl.configure(text=text)


class Viewer(tk.Toplevel):
	"""Full-size view of one image: navigate, zoom, delete, re-run its seed.

	Left / Right walk the variations of this prompt, Up / Down the prompts of
	the list (landing on their newest image), +/- and the wheel zoom, the title
	bar is draggable and a drag on the picture pans a zoomed one.
	"""

	def __init__(self, app, key, path):
		super().__init__(app)
		self.app, self.key = app, key
		self.path = Path(path)
		self.photo = None
		self.zoom = 1.0
		self._drag = None
		self._resize_job = None
		self.title("Prompt gallery - viewer")
		self.configure(bg=BG)
		self._build()
		self.show()
		self.focus_force()

	def _build(self):
		bar = tk.Frame(self, bg=PANEL)
		bar.pack(fill="x", side="top")
		self.info = tk.Label(bar, bg=PANEL, fg=DIM, font=self.app.F(9), anchor="w")
		self.info.pack(side="left", fill="x", expand=True, padx=8, pady=4)
		for text, cmd, tip in (
				("re-run this seed", self.rerun,
				 "queue this exact seed again - identical image UNLESS you changed\n"
				 "steps / cfg / negative in Settings first"),
				("delete", self.delete, "move to .trash (Ctrl+Z in the list restores it)"),
				("\u2191 prev prompt", self.prev_prompt,
				 "Up: the newest image of the previous prompt in the list"),
				("\u2193 next prompt", self.next_prompt,
				 "Down: the newest image of the next prompt in the list"),
				("< prev", self.prev, "Left: previous variation of this prompt"),
				("next >", self.next, "Right: next variation of this prompt")):
			b = self.app.mkbtn(bar, text, cmd)
			b.pack(side="right", padx=2, pady=3)
			Tooltip(b, tip)

		body = tk.Frame(self, bg=BG)
		body.pack(fill="both", expand=True)
		self.img_canvas = tk.Canvas(body, bg=BG, highlightthickness=0, bd=0)
		self.img_canvas.pack(fill="both", expand=True)
		self.img_lbl = tk.Label(self.img_canvas, bg=BG)
		self.img_win = self.img_canvas.create_window(0, 0, window=self.img_lbl,
			anchor="nw")
		self.img_lbl.bind("<Button-1>", self._drag_start)
		self.img_lbl.bind("<B1-Motion>", self._drag_move)
		self.img_lbl.bind("<ButtonRelease-1>", self._drag_end)

		self.hint = tk.Label(self, bg=BG, fg=FAINT, font=self.app.F(8),
			text="Esc close · ←/→ variations · ↑/↓ next/previous prompt · Del delete · "
				 "+/− zoom · drag a zoomed picture to pan")
		self.hint.pack(fill="x", side="bottom")

		# every key binding here returns "break": the App binds the same keys
		# with bind_all, which runs after the toplevel and would move the list
		# selection behind the viewer
		def key(seq, action):
			self.bind(seq, lambda e: (action(), "break")[1])

		key("<Escape>", self.destroy)
		key("<Left>", self.prev)
		key("<Right>", self.next)
		key("<Up>", self.prev_prompt)
		key("<Down>", self.next_prompt)
		key("<Delete>", self.delete)
		key("<plus>", lambda: self.zoom_by(1))
		key("<equal>", lambda: self.zoom_by(1))
		key("<KP_Add>", lambda: self.zoom_by(1))
		key("<minus>", lambda: self.zoom_by(-1))
		key("<KP_Subtract>", lambda: self.zoom_by(-1))
		for seq in ("<Button-4>", "<MouseWheel>"):
			self.bind(seq, lambda e: (self.zoom_by(1 if _up(e) else -1), "break")[1])
		self.bind("<Button-5>", lambda e: (self.zoom_by(-1), "break")[1])
		self.bind("<Configure>", self._on_resize)

	# ------------------------------------------------------------ navigation
	def files(self):
		return self.app.images_for(self.key)

	def show(self):
		files = self.files()
		if not files:
			self.destroy()
			return
		if self.path not in files:
			self.path = self.app.newest(files)
		self._render()
		seed = seed_of(self.path)
		index = files.index(self.path) + 1
		slug = self.key.split("::", 1)[1]
		zoom = f"{self.zoom:.0%}   " if self.zoom != 1.0 else ""
		self.info.configure(
			text=(f"{self.path.name}   ({index}/{len(files)})   "
				  f"seed {seed if seed is not None else '-'}   {zoom}{slug}"))
		self.title(f"Prompt gallery - {slug}")

	def _render(self):
		# the size is read from the mapped window, so a resize event and a zoom
		# render the same picture (a Canvas reports 1x1 before it is mapped)
		self.photo = self.app.big_photo(self.path, zoom=self.zoom,
										limit=(self.img_canvas.winfo_width(),
											   self.img_canvas.winfo_height()))
		if self.photo is None:
			self.img_lbl.configure(image="", text="cannot display this file",
								   fg=DIM, font=self.app.F(11))
			return
		self.img_lbl.configure(image=self.photo, text="")
		self.img_canvas.configure(
			scrollregion=(0, 0, self.photo.width(), self.photo.height()))

	def _step(self, delta):
		files = self.files()
		if not files:
			return
		index = files.index(self.path) if self.path in files else 0
		self.path = files[(index + delta) % len(files)]
		self.zoom = 1.0
		self.show()

	def next(self):
		self._step(1)

	def prev(self):
		self._step(-1)

	# ------------------------------------------------------- next/prev prompt
	def _step_prompt(self, delta):
		keys = self.app.visible_keys or self.app.job_order
		if not keys or self.key not in keys:
			return
		start = keys.index(self.key)
		for step in range(1, len(keys) + 1):
			key = keys[(start + delta * step) % len(keys)]
			files = self.app.images_for(key)
			if files:
				self.key = key
				self.path = self.app.newest(files)
				self.zoom = 1.0
				self.show()
				self.app.select_key(key)
				return
		self.app.status("no other prompt has an image yet")

	def next_prompt(self):
		self._step_prompt(1)

	def prev_prompt(self):
		self._step_prompt(-1)

	# ------------------------------------------------------------ zoom / pan
	def zoom_by(self, steps):
		self.zoom = max(0.25, min(4.0, self.zoom * (1.25 ** steps)))
		self.show()

	def _drag_start(self, event):
		self.focus_force()
		self._drag = (event.x, event.y,
					  self.img_canvas.xview()[0], self.img_canvas.yview()[0])

	def _drag_move(self, event):
		if not self._drag or self.photo is None or self.zoom == 1.0:
			return
		x0, y0, xv, yv = self._drag
		width = max(1, self.photo.width())
		height = max(1, self.photo.height())
		self.img_canvas.xview_moveto(max(0.0, min(1.0, xv - (event.x - x0) / width)))
		self.img_canvas.yview_moveto(max(0.0, min(1.0, yv - (event.y - y0) / height)))

	def _drag_end(self, _event):
		self._drag = None

	def _on_resize(self, _event):
		if self._resize_job:
			self.after_cancel(self._resize_job)
		self._resize_job = self.after(150, self._after_resize)

	def _after_resize(self):
		self._resize_job = None
		self.show()

	# --------------------------------------------------------------- actions
	def delete(self):
		self.app.delete_image(self.path, quiet=True)
		self.show()

	def rerun(self):
		seed = seed_of(self.path)
		if seed is None:
			self.app.status("this is a batch image - no seed in its name, "
							"cannot re-run exactly")
			return
		self.app.enqueue_variations(self.key, count=1, seed=seed)
		self.destroy()


def _up(event):
	if getattr(event, "num", None):
		return event.num == 4
	return getattr(event, "delta", 0) > 0


class SettingsDialog(tk.Toplevel):
	def __init__(self, app):
		super().__init__(app)
		self.app = app
		self.title("Prompt gallery - settings")
		self.configure(bg=PANEL, padx=14, pady=12)
		self.transient(app)
		self.grab_set()
		F = app.F
		c = self.app.cfg

		def row(label, widget):
			tk.Label(self, text=label, bg=PANEL, fg=DIM, font=F(9)).pack(anchor="w")
			widget.pack(anchor="w", fill="x", pady=(0, 8))

		def entry(value):
			e = tk.Entry(self, bg=BTN, fg=FG, insertbackground=FG, relief="flat",
						 highlightthickness=1, highlightbackground=EDGE,
						 highlightcolor=ACCENT)
			e.insert(0, str(value))
			return e

		self.server = entry(c("server"))
		row("ComfyUI server URL", self.server)

		self.var = entry(c("variations"))
		row("Variations per queue click (1-9)", self.var)

		self.steps = entry(c("steps"))
		row("KSampler steps (blank = workflow default, MOSS likes >=50)", self.steps)

		self.cfgv = entry(c("cfg"))
		row("KSampler CFG (blank = workflow default, MOSS likes 3.0)", self.cfgv)

		self.neg = entry(c("negative"))
		row("Negative prompt", self.neg)

		self.slg = tk.BooleanVar(value=bool(c("slg")))
		tk.Checkbutton(self, text="SkipLayerGuidance (skip layer 22) - on is MOSS's advice",
					   variable=self.slg, bg=PANEL, fg=FG, selectcolor=SELECT,
					   activebackground=PANEL, bd=0, anchor="w",
					   font=F(9)).pack(anchor="w")

		tk.Label(self, text="Run batch starts at once: its own window shows launch.py\n"
							"and a stop button, and closing the window keeps it running.",
				 bg=PANEL, fg=FAINT, font=F(8), justify="left").pack(anchor="w",
																		pady=(0, 10))

		btns = tk.Frame(self, bg=PANEL)
		btns.pack(fill="x")
		self.app.mkbtn(btns, "Save", self.save, primary=True).pack(side="right")
		self.app.mkbtn(btns, "Cancel", self.destroy).pack(side="right", padx=6)

	def save(self):
		try:
			var = max(1, min(9, int(self.var.get() or 1)))
		except ValueError:
			var = 1
		app = self.app
		app.st.setdefault("app", {}).update({
			"server": self.server.get().strip().rstrip("/") or launch.DEFAULT_SERVER,
			"variations": var,
			"steps": self.steps.get().strip(),
			"cfg": self.cfgv.get().strip(),
			"negative": self.neg.get(),
			"slg": bool(self.slg.get()),
		})
		app.save_state_now()
		app.status("settings saved to state.toml")
		if app.spin_var.get() != var:
			app.spin_var.set(var)
		app.update_server_label()
		self.destroy()


class BatchWindow(tk.Toplevel):
	"""The launch.py log; lines are buffered so a drain tick is one insert."""

	def __init__(self, app, proc, force):
		super().__init__(app)
		self.app, self.proc = app, proc
		self.title("Prompt gallery - batch " + ("(force)" if force else "(missing only)"))
		self.configure(bg=BG, padx=8, pady=8)
		self.geometry("760x480")
		self._buffer = []
		self.log = tk.Text(self, bg=CARD, fg=FG, relief="flat", font=("Courier", 9),
						   state="disabled", wrap="word")
		self.log.pack(fill="both", expand=True)
		bar = tk.Frame(self, bg=BG)
		bar.pack(fill="x", pady=(6, 0))
		self.stop_btn = app.mkbtn(bar, "Stop batch", self.stop)
		self.stop_btn.pack(side="left")
		app.mkbtn(bar, "Close window", self.close).pack(side="left", padx=6)
		tk.Label(bar, text="the batch keeps rendering if you close the window",
				 bg=BG, fg=FAINT, font=app.F(8)).pack(side="right")
		self.protocol("WM_DELETE_WINDOW", self.close)

	def append(self, line):
		self._buffer.append(line)
		if len(self._buffer) >= 200:
			self.flush()

	def flush(self):
		if not self._buffer:
			return
		lines, self._buffer = self._buffer, []
		at_end = self.log.yview()[1] >= 0.999  # a reader scrolled up is not yanked
		self.log.configure(state="normal")
		self.log.insert("end", "\n".join(lines) + "\n")
		self.log.configure(state="disabled")
		if at_end:
			self.log.see("end")

	def stop(self):
		try:
			self.proc.terminate()
		except Exception:
			pass
		self.append("--- stop requested ---")
		self.flush()

	def close(self):
		self.app.batch_win = None
		self.destroy()


class ScrollFrame(tk.Frame):
	"""A frame with its own wheel-scrolled viewport (the sidebar can outgrow a
	short window once several prompt files and workflows are listed)."""

	def __init__(self, parent, bg):
		super().__init__(parent, bg=bg)
		self.canvas = tk.Canvas(self, bg=bg, highlightthickness=0, bd=0)
		self.vsb = tk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
		self.canvas.configure(yscrollcommand=self.vsb.set)
		self.vsb.pack(side="right", fill="y")
		self.canvas.pack(side="left", fill="both", expand=True)
		self.body = body = tk.Frame(self.canvas, bg=bg)
		self.win = self.canvas.create_window((0, 0), window=body, anchor="nw")
		body.bind("<Configure>", lambda _e: self.canvas.configure(
			scrollregion=self.canvas.bbox("all")))
		self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(
			self.win, width=e.width))


class App(tk.Tk):
	LIST, GRID = "list", "grid"

	def __init__(self):
		super().__init__()
		self.title(f"{launch.CONFIG['name']} · Prompt gallery")
		self.configure(bg=BG)
		self.geometry("1320x860")
		self.minsize(980, 620)

		fam = tkfont.nametofont("TkDefaultFont").actual("family")
		self.F = lambda s, b=False: (fam, s, "bold") if b else (fam, s)

		# ------------------------------------------------------------ state
		self.st = launch.load_state()
		self.st.setdefault("app", {})
		for k, v in DEFAULTS.items():
			self.st["app"].setdefault(k, v)

		# ------------------------------------------------------- discovery
		self.md_paths = launch.find_prompt_mds()
		self.wf_paths = launch.find_workflows()
		self.wf_stems = {p.stem for p in self.wf_paths}
		self.wf_templates = {}
		self.jobs, self.job_order, self.job_md = {}, [], {}
		self.md_jobs = {p.name: [] for p in self.md_paths}
		for md in self.md_paths:
			for job in launch.parse_prompts(md):
				key = launch.job_state_key(md, job)
				if key in self.jobs:  # duplicate slug in one file
					continue
				self.jobs[key] = job
				self.job_md[key] = md.name
				self.job_order.append(key)
				self.md_jobs[md.name].append(key)
		self.stem_owner = {self.jobs[key]["slug"].replace(" ", "_"): key
						   for key in self.job_order}

		# ---------------------------------------------------------- runtime
		self.ev = queue.Queue()
		self.pending = {}        # prompt_id -> (job_key, seed, workflow stem)
		self.pending_fails = {}
		self.trash_stack = []
		self.batch_proc = None
		self.batch_win = None
		self.card_w = 760
		self._stop = False
		self._thumb_cache = {}
		self._thumb_order = []
		self._resize_job = None
		self._filter_job = None
		self._last_scan = None
		self.files_by_key = {}
		self.orphans = 0
		self.server_ok = None
		self.mode = self.LIST
		self._columns_drawn = 0
		self.cards = {}          # key -> PromptCard on screen
		self.grid_cells = {}     # path -> cell (grid mode)
		self.visible_keys = []
		self.key_index = {}
		self.selected = -1
		self._grid_photo = {}    # keep grid PhotoImage masters alive
		self._drag = None

		self._build_toolbar()
		self._build_statusbar()
		self._build_body()
		self._bind_keys()

		self.index_scan(self.scan_output())
		self.rebuild_cards()

		self.bind_all("<Control-z>", self.undo_delete)
		self.protocol("WM_DELETE_WINDOW", self._on_close)

		threading.Thread(target=self._worker, daemon=True).start()
		self.after(150, self._drain)

	# ================================================================ UI
	def mkbtn(self, parent, text, cmd, primary=False, width=None):
		b = tk.Button(parent, text=text, command=cmd, bd=0, cursor="hand2",
					  padx=10, pady=4 if not primary else 5,
					  bg=ACCENT if primary else BTN,
					  fg=ACCENT_TXT if primary else FG,
					  activebackground=ACCENT if primary else BTN_ACTIVE,
					  activeforeground=ACCENT_TXT if primary else FG,
					  disabledforeground=FAINT,
					  font=self.F(9, primary))
		if width:
			b.configure(width=width)
		return b

	def _build_toolbar(self):
		bar = tk.Frame(self, bg=PANEL, padx=10, pady=8)
		bar.pack(fill="x")
		self.mkbtn(bar, "Refresh", self.refresh).pack(side="left")
		tk.Label(bar, text="  filter", bg=PANEL, fg=DIM,
				 font=self.F(9)).pack(side="left")
		self.filter_var = tk.StringVar()
		self.filter_entry = tk.Entry(bar, textvariable=self.filter_var, width=22,
					bg=BTN, fg=FG, insertbackground=FG, relief="flat",
					highlightthickness=1, highlightbackground=EDGE,
					highlightcolor=ACCENT)
		self.filter_entry.pack(side="left", padx=(4, 4), ipady=2)
		self.filter_var.trace_add("write", lambda *_: self._queue_filter())
		self.filter_entry.bind("<Escape>", self._clear_filter)

		tk.Label(bar, text="variations", bg=PANEL, fg=DIM,
				 font=self.F(9)).pack(side="left", padx=(10, 0))
		self.spin_var = tk.IntVar(value=int(self.cfg("variations")))
		tk.Spinbox(bar, from_=1, to=9, width=2, textvariable=self.spin_var,
				   buttonbackground=BTN, bg=BTN, fg=FG, relief="flat",
				   insertbackground=FG, highlightthickness=1,
				   highlightbackground=EDGE, highlightcolor=ACCENT).pack(
			side="left", padx=4)
		self.spin_var.trace_add("write", self._spin_changed)
		self.mkbtn(bar, "Queue all enabled", self.enqueue_all,
				   primary=True).pack(side="left", padx=(12, 0))
		self.batch_btn = self.mkbtn(bar, "Run batch", self.run_batch)
		self.batch_btn.pack(side="left", padx=(12, 0))
		self.batch_btn.bind("<Button-3>", lambda e: self.run_batch(force=True))
		Tooltip(self.batch_btn,
				"run launch.py (queue everything still missing, wait, download)\n"
				"right-click = --force (re-render even if the PNG exists)")
		self.mkbtn(bar, "Open output", self.open_output).pack(side="left", padx=6)
		self.mkbtn(bar, "Settings", self.open_settings).pack(side="right")
		self.view_btn = self.mkbtn(bar, "grid", self.toggle_mode)
		self.view_btn.pack(side="right", padx=(0, 6))
		Tooltip(self.view_btn, "G: every image as a thumbnail, no prompt cards")
		self.project_lbl = tk.Label(bar, text=launch.CONFIG["name"], bg=PANEL,
									fg=FAINT, font=self.F(8))
		self.project_lbl.pack(side="right", padx=(0, 10))

	def _build_body(self):
		side_wrap = tk.Frame(self, bg=PANEL, width=300)
		side_wrap.pack(side="left", fill="y")
		side_wrap.pack_propagate(False)
		side = self.side = ScrollFrame(side_wrap, bg=PANEL)
		side.pack(fill="both", expand=True)
		F9 = self.F(9)
		box = side.body

		wf_box = tk.LabelFrame(box, text=" Workflows ", bg=PANEL, fg=FG,
							   bd=0, highlightthickness=1,
							   highlightbackground=EDGE, padx=8, pady=6)
		wf_box.pack(fill="x", padx=10, pady=(10, 0))
		if not self.wf_paths:
			tk.Label(wf_box, text="none found - drop a ComfyUI API-format "
					 "*.json next to gallery.py", bg=PANEL, fg=FAINT,
					 font=F9, wraplength=240, justify="left").pack(anchor="w")
		self.wf_stats = {}
		for p in self.wf_paths:
			var = tk.BooleanVar(value=self.wf_enabled(p.name))
			tk.Checkbutton(wf_box, text=p.name, variable=var,
						   command=lambda p=p, v=var: self._wf_toggle(p, v),
						   bg=PANEL, fg=FG, selectcolor=SELECT,
						   activebackground=PANEL, anchor="w", bd=0,
						   font=F9).pack(fill="x", anchor="w")
			st = tk.Label(wf_box, text="", bg=PANEL, fg=FAINT, font=self.F(8))
			st.pack(anchor="w", padx=(20, 0))
			self.wf_stats[p.name] = (var, st)

		md_box = tk.LabelFrame(box, text=" Prompt files ", bg=PANEL, fg=FG,
							   bd=0, highlightthickness=1,
							   highlightbackground=EDGE, padx=8, pady=6)
		md_box.pack(fill="x", padx=10, pady=(10, 0))
		if not self.md_paths:
			tk.Label(md_box, text="none found - drop a prompts *.md with "
					 "### N · category · slug -> `file` headings",
					 bg=PANEL, fg=FAINT, font=F9, wraplength=240,
					 justify="left").pack(anchor="w")
		self.md_stats = {}
		for p in self.md_paths:
			var = tk.BooleanVar(value=self.md_enabled(p.name))
			tk.Checkbutton(md_box, text=p.name, variable=var,
						   command=lambda p=p, v=var: self._md_toggle(p, v),
						   bg=PANEL, fg=FG, selectcolor=SELECT,
						   activebackground=PANEL, anchor="w", bd=0,
						   font=F9).pack(fill="x", anchor="w")
			st = tk.Label(md_box, text="", bg=PANEL, fg=FAINT, font=self.F(8))
			st.pack(anchor="w", padx=(20, 0))
			self.md_stats[p.name] = (var, st)

		srv_box = tk.LabelFrame(box, text=" ComfyUI ", bg=PANEL, fg=FG,
								bd=0, highlightthickness=1,
								highlightbackground=EDGE, padx=8, pady=6)
		srv_box.pack(fill="x", padx=10, pady=(10, 0))
		self.server_lbl = tk.Label(srv_box, text="", bg=PANEL, fg=DIM,
								   font=self.F(8), wraplength=240, justify="left")
		self.server_lbl.pack(anchor="w")
		self.queue_lbl = tk.Label(srv_box, text="queue -", bg=PANEL, fg=DIM, font=F9)
		self.queue_lbl.pack(anchor="w")
		self.pend_lbl = tk.Label(srv_box, text="downloads -", bg=PANEL, fg=DIM, font=F9)
		self.pend_lbl.pack(anchor="w")
		self.update_server_label()

		self.mkbtn(box, "Switch project…", self.switch_project).pack(
			fill="x", padx=10, pady=(12, 0))
		self.side_note = tk.Label(box, text="", bg=PANEL, fg=FAINT,
								  font=self.F(8), justify="left", wraplength=250)
		self.side_note.pack(fill="x", padx=10, pady=(12, 10))

		# ---------------------------------------------------------- photos
		right = tk.Frame(self, bg=BG)
		right.pack(side="left", fill="both", expand=True)
		self.vsb = tk.Scrollbar(right, orient="vertical")
		self.canvas = tk.Canvas(right, bg=BG, highlightthickness=0)
		self.vsb.configure(command=self.canvas.yview)
		self.canvas.configure(yscrollcommand=self.vsb.set)
		self.vsb.pack(side="right", fill="y")
		self.canvas.pack(side="left", fill="both", expand=True)
		self.cards_frame = tk.Frame(self.canvas, bg=BG)
		self.cards_win = self.canvas.create_window((0, 0), window=self.cards_frame,
												  anchor="nw")
		# the scrollregion follows both the canvas width (a window resize keeps
		# the fitted card width, so no widget configure fires) and the frame
		self.canvas.bind("<Configure>", self._on_geometry_change)
		self.cards_frame.bind("<Configure>", self._on_geometry_change)
		self._bind_wheel()
		self._bind_drag()
		self.list_hint = tk.Label(right, bg=PANEL, fg=FAINT, anchor="w",
								  padx=10, pady=3, font=self.F(8),
								  text=self.hint_text())
		self.list_hint.pack(side="bottom", fill="x")

	def hint_text(self):
		if self.mode == self.GRID:
			return ("click a thumbnail: viewer · wheel, right-drag or PgUp/PgDn: "
					"scroll · /: filter · G: back to prompt cards")
		return ("click a thumbnail: viewer · wheel or right-drag: scroll · "
				"↑↓ [ ]: select, Enter: open · /: filter · G: grid")

	def _build_statusbar(self):
		sb = tk.Frame(self, bg=PANEL, padx=10, pady=4)
		sb.pack(fill="x", side="bottom")
		self.status_lbl = tk.Label(sb, text="ready", bg=PANEL, fg=DIM,
								   anchor="w", font=self.F(9))
		self.status_lbl.pack(side="left", fill="x", expand=True)
		self.server_dot = tk.Label(sb, text="\u25cf ?  server unchecked",
									bg=PANEL, fg=FAINT, font=self.F(9))
		self.server_dot.pack(side="right")

	# ========================================================== wheel and pan
	def _wheel_target(self, event):
		"""Which scrolled pane the pointer is over, if any.

		One containment walk from the widget under the pointer: a per-widget
		binding would miss the labels inside a card, and an ungated bind_all
		would scroll the list while the batch log is being read.
		"""
		w = self.winfo_containing(event.x_root, event.y_root)
		while w is not None:
			if w is self.canvas:
				return self.canvas
			side = getattr(self, "side", None)
			if side is not None and w is side.canvas:
				return side.canvas
			w = getattr(w, "master", None)
		return None

	def wheel(self, event):
		target = self._wheel_target(event)
		if target is None:
			return None
		# three units per notch is the browser convention; Windows/macOS send
		# one event per notch with a signed delta, X11 sends Button-4/5
		target.yview_scroll(-3 if _up(event) else 3, "units")
		return "break"

	def _bind_wheel(self):
		# bind_all plus the containment walk of _wheel_target: the prompt list
		# and the sidebar each scroll under the pointer, everything else (the
		# batch log's Text, the viewer) keeps its wheel
		for seq in ("<Button-4>", "<Button-5>", "<MouseWheel>"):
			try:
				self.bind_all(seq, self.wheel, add="+")
			except tk.TclError:
				pass  # not a valid event on this platform

	def _bind_drag(self):
		# right / middle drag anywhere over the cards, left drag on the canvas
		# itself; a left click on a thumbnail stays a click and opens the viewer
		for seq in ("<ButtonPress-3>", "<ButtonPress-2>"):
			self.canvas.bind(seq, self._drag_start, add="+")
			self.cards_frame.bind(seq, self._drag_start, add="+")
		for seq in ("<B3-Motion>", "<B2-Motion>"):
			self.canvas.bind(seq, self._drag_move, add="+")
			self.cards_frame.bind(seq, self._drag_move, add="+")
		for seq in ("<ButtonRelease-3>", "<ButtonRelease-2>"):
			self.canvas.bind(seq, self._drag_end, add="+")
			self.cards_frame.bind(seq, self._drag_end, add="+")
		self.canvas.bind("<ButtonPress-1>", self._drag_start, add="+")
		self.canvas.bind("<B1-Motion>", self._drag_move, add="+")
		self.canvas.bind("<ButtonRelease-1>", self._drag_end, add="+")

	def _drag_start(self, event):
		self._drag = (event.y_root, self.canvas.yview()[0])
		self.canvas.configure(cursor="fleur")

	def _drag_move(self, event):
		if not self._drag:
			return
		y0, frac = self._drag
		region = self.canvas.bbox("all")
		height = max(1, (region[3] - region[1]) if region else 1)
		self.canvas.yview_moveto(max(0.0, min(1.0, frac - (event.y_root - y0) / height)))

	def _drag_end(self, _event):
		self._drag = None
		self.canvas.configure(cursor="")

	# ================================================================ keys
	def _typing(self, event):
		try:
			return event.widget.winfo_class() in ("Entry", "Text", "Spinbox")
		except Exception:
			return False

	def _on_key(self, event, action):
		if self._typing(event):
			return None  # let the Entry receive the character
		action()
		return "break"

	def _bind_keys(self):
		def bind(seq, action):
			self.bind_all(seq, lambda e: self._on_key(e, action))

		bind("<Key-g>", self.toggle_mode)
		bind("<Key-G>", self.toggle_mode)
		bind("<Key-bracketleft>", lambda: self.step_selected(-1))
		bind("<Key-bracketright>", lambda: self.step_selected(1))
		bind("<Key-Up>", lambda: self.step_selected(-1))
		bind("<Key-Down>", lambda: self.step_selected(1))
		bind("<Return>", self.open_selected)
		bind("<slash>", self.focus_filter)
		bind("<Next>", lambda: self.page(1))
		bind("<Prior>", lambda: self.page(-1))
		self.bind_all("<Escape>", self._on_escape)

	def _on_escape(self, event):
		if self._typing(event):
			return None
		self._clear_filter()
		return "break"

	def focus_filter(self):
		self.filter_entry.focus_set()
		self.filter_entry.selection_range(0, "end")

	def _clear_filter(self, _event=None):
		if self.filter_var.get():
			self.filter_var.set("")
			self.status("filter cleared")
		elif self.selected >= 0:
			self.selected = -1
			self._paint_selection()

	def page(self, direction):
		self.canvas.yview_scroll(direction * 4, "units")

	# ================================================================ state
	def cfg(self, key):
		return self.st.get("app", {}).get(key, DEFAULTS[key])

	def md_enabled(self, name):
		return (self.st.get("prompts") or {}).get(name, True)

	def wf_enabled(self, name):
		return (self.st.get("workflows") or {}).get(
			name, Path(name).stem == launch.CONFIG.get("default_workflow"))

	def job_enabled(self, key):
		return (self.st.get("jobs") or {}).get(key, True)

	def save_state_now(self):
		launch.save_state(self.st)

	def toggle_job(self, key, value):
		"""A prompt checkbox is one file write and one card repaint.

		The old path rebuilt every card per click: a full directory scan, a
		thumbnail pass and a widget destroy for a change that touches one card.
		"""
		value = bool(value)
		if self.job_enabled(key) == value:
			return
		self.st.setdefault("jobs", {})[key] = value
		self.save_state_now()
		card = self.cards.get(key)
		if card is not None:
			card.enabled = value and self.md_enabled(self.job_md[key])
			card._paint_enable()
			card.paint_bg(self.card_bg(card))
		self.status(f"state.toml saved - {key} = {str(value).lower()}")

	def _md_toggle(self, p, var):
		self.st.setdefault("prompts", {})[p.name] = bool(var.get())
		self.save_state_now()
		self.status(f"state.toml saved - prompt file {p.name}")
		for key in self.md_jobs.get(p.name, []):
			card = self.cards.get(key)
			if card is not None:
				card.enabled = self.job_enabled(key) and bool(var.get())
				card._paint_enable()
				card.paint_bg(self.card_bg(card))
		self.update_sidebar_stats()

	def _wf_toggle(self, p, var):
		self.st.setdefault("workflows", {})[p.name] = bool(var.get())
		self.save_state_now()
		self.status(f"state.toml saved - workflow {p.name}")
		self.update_sidebar_stats()

	def _spin_changed(self, *_):
		try:
			val = max(1, min(9, int(self.spin_var.get())))
		except Exception:
			return
		if self.st["app"].get("variations") != val:
			self.st["app"]["variations"] = val
			self.save_state_now()

	# ================================================================ images
	def scan_output(self):
		"""The output dir in one pass: name -> (mtime, size). Files younger
		than SETTLE_S are skipped, because a writer may still be filling them."""
		out = {}
		if not OUTPUT_DIR.exists():
			return out
		now = time.time()
		for p in OUTPUT_DIR.iterdir():
			if not p.is_file() or p.suffix.lower() not in IMAGE_EXTS:
				continue
			try:
				st = p.stat()
			except OSError:
				continue
			if st.st_size == 0 or now - st.st_mtime < SETTLE_S:
				continue
			out[p.name] = (st.st_mtime, st.st_size)
		return out

	def index_scan(self, scan):
		"""Group the scanned names by prompt once: base target first, then the
		variations oldest to newest (a stable sort, so a mtime tie keeps name
		order and the list never jumps between two worker ticks)."""
		by_key, orphans = {}, 0
		for name, (mtime, _size) in scan.items():
			key = self.stem_owner.get(split_name(name, self.wf_stems))
			if key is None:
				orphans += 1
				continue
			by_key.setdefault(key, []).append((mtime, name))
		for key, rows in by_key.items():
			rows.sort(key=lambda r: (seed_of(r[1]) is not None, r[0], r[1]))
			by_key[key] = [OUTPUT_DIR / name for _mtime, name in rows]
		self.files_by_key = by_key
		self.orphans = orphans

	def images_for(self, key):
		return self.files_by_key.get(key, [])

	def newest(self, files):
		seeded = [p for p in files if seed_of(p) is not None]
		return (seeded or files)[-1]

	def columns(self):
		return max(1, (self.card_w - CARD_PAD) // (THUMB_W + 10))

	def thumb_photo(self, path):
		try:
			st = path.stat()
			key = (str(path), st.st_mtime_ns, st.st_size)
		except OSError:
			return None
		cached = self._thumb_cache.get(key)
		if cached is not None:
			return cached
		photo = None
		try:
			if PIL_OK:
				im = Image.open(path)
				im.draft("RGB", (THUMB_W * 2, THUMB_H * 2))
				im.thumbnail((THUMB_W, THUMB_H))
				photo = ImageTk.PhotoImage(im)
			else:
				raw = tk.PhotoImage(file=str(path))
				sx = max(1, math.ceil(raw.width() / THUMB_W))
				sy = max(1, math.ceil(raw.height() / THUMB_H))
				photo = raw.subsample(max(sx, sy), max(sx, sy))
		except Exception:
			return None
		self._thumb_cache[key] = photo
		self._thumb_order.append(key)
		if len(self._thumb_order) > 600:
			for k in self._thumb_order[:200]:
				self._thumb_cache.pop(k, None)
			self._thumb_order = self._thumb_order[-400:]
		return photo

	def big_photo(self, path, zoom=1.0, limit=None):
		try:
			screen_w = self.winfo_screenwidth() - 160
			screen_h = self.winfo_screenheight() - 220
			max_w = int((limit[0] if limit and limit[0] > 200 else screen_w) * zoom)
			max_h = int((limit[1] if limit and limit[1] > 200 else screen_h) * zoom)
			if PIL_OK:
				im = Image.open(path)
				im.thumbnail((max_w, max_h))
				return ImageTk.PhotoImage(im)
			raw = tk.PhotoImage(file=str(path))
			s = max(1, math.ceil(max(raw.width() / max_w, raw.height() / max_h)))
			return raw.subsample(s, s)
		except Exception:
			return None

	def delete_image(self, path, quiet=False):
		path = Path(path)
		if not path.exists():
			return
		try:
			TRASH_DIR.mkdir(parents=True, exist_ok=True)
			dest = TRASH_DIR / path.name
			i = 1
			while dest.exists():
				dest = TRASH_DIR / f"{path.stem}-{i}{path.suffix}"
				i += 1
			path.rename(dest)
		except Exception as e:
			self.status(f"delete failed: {e}")
			return
		self.trash_stack.append(dest)
		if not quiet:
			self.status(f"moved to .trash: {path.name}  (Ctrl+Z to undo)")
		self.rescan_now()

	def undo_delete(self, _event=None):
		if not self.trash_stack:
			self.status("nothing to undo")
			return
		src = self.trash_stack.pop()
		if not src.exists():
			self.status("trashed file is gone")
			return
		dest = OUTPUT_DIR / src.name
		if dest.exists():
			self.status(f"cannot undo: {src.name} already exists - left in .trash")
			return
		src.rename(dest)
		self.status(f"restored {src.name}")
		self.rescan_now()

	def rescan_now(self):
		"""Repaint from disk after a change this app made itself."""
		self.index_scan(self.scan_output())
		self.sync_cards()

	# ================================================================ queue
	def enabled_workflows(self):
		return [p for p in self.wf_paths if self.wf_enabled(p.name)]

	def template(self, wf_path):
		if wf_path not in self.wf_templates:
			self.wf_templates[wf_path] = json.loads(
				wf_path.read_text(encoding="utf-8"))
		return self.wf_templates[wf_path]

	def _sampler_args(self):
		def num(cast):
			raw = str(self.cfg("steps" if cast is int else "cfg") or "").strip()
			if not raw:
				return None
			try:
				return int(raw) if cast is int else float(raw)
			except ValueError:
				return None
		return SimpleNamespace(
			steps=num(int), cfg=num(float),
			negative=str(self.cfg("negative")),
			no_slg=not bool(self.cfg("slg")),
		)

	def enqueue_variations(self, key, count=None, seed=None, quiet=False):
		job = self.jobs.get(key)
		if job is None:
			return 0
		md = self.job_md[key]
		if not self.md_enabled(md) or not self.job_enabled(key):
			self.status(f"'{job['slug']}' is disabled - enable it first")
			return 0
		wfs = self.enabled_workflows()
		if not wfs:
			if not quiet:
				messagebox.showwarning(
					"no workflow", "No workflow is enabled.\n"
					"Tick at least one *.json under 'Workflows'.")
			return 0
		if count is None:
			try:
				count = max(1, min(9, int(self.spin_var.get())))
			except Exception:
				count = 1
		server = str(self.cfg("server"))
		args = self._sampler_args()
		queued, first_err = 0, None
		for wfp in wfs:
			try:
				template = self.template(wfp)
				if not launch.compatible(template, job):
					continue
				for _ in range(count):
					s = seed if seed is not None else random.randint(1, 2**63 - 1)
					wf = launch.patch_workflow(template, job, s, args)
					pid = launch.queue_job(server, wf, job["slug"])
					self.pending[pid] = (key, s, wfp.stem)
					self.pending_fails.pop(pid, None)
					queued += 1
			except SystemExit as e:
				first_err = first_err or f"{wfp.name}: {e}"
			except Exception as e:
				first_err = first_err or f"{wfp.name}: {' '.join(str(e).split())[:300]}"
		if queued:
			self.status(f"queued {queued} job{'s' if queued != 1 else ''} - "
						f"{job['slug']}" + (f" (seed {seed})" if seed else ""))
			self.sync_cards()
		elif first_err and not quiet:
			messagebox.showerror("queue failed", first_err)
		elif first_err:
			self.status(f"queue failed - {' '.join(first_err.split())[:160]}")
		return queued

	def enqueue_all(self):
		keys = [k for k in self.job_order
				if self.job_enabled(k) and self.md_enabled(self.job_md[k])]
		if not keys:
			self.status("no enabled prompts to queue")
			return
		total = 0
		for k in keys:
			total += self.enqueue_variations(k, quiet=True) or 0
		self.status(f"queued {total} variation job(s) across {len(keys)} enabled prompt(s)")

	def copy_caption(self, key):
		job = self.jobs.get(key)
		if not job:
			return
		self.clipboard_clear()
		self.clipboard_append(job["caption"])
		self.status(f"caption of '{job['slug']}' copied to clipboard")

	# ============================================================= batch run
	def run_batch(self, force=False):
		if self.batch_proc and self.batch_proc.poll() is None:
			messagebox.showinfo("batch running",
								"A batch is already running in its own window.")
			return
		cmd = [sys.executable, str(HERE / "launch.py"),
			   "--project", str(launch.PROJECT_PATH)]
		if force:
			cmd.append("--force")
		try:
			self.batch_proc = subprocess.Popen(
				cmd, cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
				text=True, bufsize=1)
		except Exception as e:
			messagebox.showerror("batch failed", str(e))
			return
		self.batch_win = BatchWindow(self, self.batch_proc, force)

		def pump():
			try:
				for line in self.batch_proc.stdout:
					self.ev.put(("batch_line", line.rstrip("\n")))
				self.ev.put(("batch_done", self.batch_proc.wait()))
			except Exception:
				pass
		threading.Thread(target=pump, daemon=True).start()

	def open_output(self):
		try:
			OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
			if sys.platform.startswith("win"):
				os.startfile(str(OUTPUT_DIR))
			elif sys.platform == "darwin":
				subprocess.Popen(["open", str(OUTPUT_DIR)])
			else:
				subprocess.Popen(["xdg-open", str(OUTPUT_DIR)])
			self.status(f"opened {OUTPUT_DIR}")
		except Exception as e:
			self.status(f"could not open folder: {e}")

	def open_settings(self):
		SettingsDialog(self)

	def refresh(self):
		self._last_scan = None  # force the worker to report a scan
		self._thumb_cache.clear()
		self._thumb_order = []
		self._grid_photo = {}
		self.rebuild_cards()
		self.status("refreshed")

	def switch_project(self):
		path = filedialog.askopenfilename(title="Open generator project",
			initialdir=HERE, filetypes=[("Project JSON", "*.json")])
		if not path:
			return
		try:
			config, _base = launch.core.load_project(path)
			for key in ("name", "prompts", "workflows", "output"):
				config[key]
		except Exception as error:
			messagebox.showerror("Invalid project", str(error))
			return
		self.save_state_now()
		subprocess.Popen([sys.executable, str(HERE / "gallery.py"), "--project", path])
		self._on_close()

	def open_viewer(self, key, path):
		if Path(path).suffix.lower() in VIDEO_EXTS:
			if sys.platform == "win32":
				os.startfile(str(path))
			else:
				subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open",
								  str(path)])
			return
		self.select_key(key)
		viewer = getattr(self, "_viewer", None)
		if viewer is not None and viewer.winfo_exists():
			viewer.key = key
			viewer.path = Path(path)
			viewer.zoom = 1.0
			viewer.show()
			viewer.lift()
			viewer.focus_force()
			return
		self._viewer = Viewer(self, key, path)

	# ================================================================ cards
	def _queue_filter(self):
		if self._filter_job:
			self.after_cancel(self._filter_job)
		self._filter_job = self.after(250, self.rebuild_cards)

	def _on_geometry_change(self, event):
		if event.widget is self.canvas:
			self.card_w = event.width - 8
			self.canvas.itemconfigure(self.cards_win, width=self.card_w)
		self.canvas.configure(scrollregion=self.canvas.bbox("all"))
		if event.widget is self.cards_frame:
			self._maybe_reflow()

	def _maybe_reflow(self):
		"""Thumbnails are packed in columns of a fixed thumb width: rebuild only
		when the column count changes, never on a pixel of resize."""
		if self.columns() == self._columns_drawn:
			return
		if self._resize_job:
			self.after_cancel(self._resize_job)
		self._resize_job = self.after(250, self.rebuild_cards)

	def matches(self, key):
		flt = self.filter_var.get().strip().lower() if hasattr(self, "filter_var") else ""
		if not flt:
			return True
		job = self.jobs[key]
		return flt in f"{key} {job['category']} {job['caption']}".lower()

	def rebuild_cards(self):
		"""The card set changed (filter, prompt file, size, mode): rebuild."""
		if self._resize_job:
			self.after_cancel(self._resize_job)
			self._resize_job = None
		top = self.canvas.yview()[0]
		for widget in self.cards_frame.winfo_children():
			widget.destroy()
		self.cards, self.grid_cells, self._grid_photo = {}, {}, {}
		keys = [k for k in self.job_order if self.matches(k)]
		self.visible_keys = keys
		if self.selected >= len(keys):
			self.selected = -1
		self.key_index = {key: i for i, key in enumerate(keys)}
		if self.mode == self.GRID:
			self._build_grid(keys)
		else:
			counts = self.pending_counts()
			for key in keys:
				card = PromptCard(self.cards_frame, self, key)
				card.set_images(self.images_for(key), counts.get(key, 0))
				card.set_counts()
				self.cards[key] = card
			self._paint_selection()
		self._columns_drawn = self.columns()
		self.cards_frame.update_idletasks()
		self.canvas.configure(scrollregion=self.canvas.bbox("all"))
		self.canvas.yview_moveto(top)
		self.update_sidebar_stats()
		return len(keys)

	def sync_cards(self):
		"""Only files or queue counts changed: repaint what changed.

		This is the path a download, a delete, an undo and every worker tick
		take, so it must never destroy a card: the list keeps its scroll
		offset, its hover and the checkbox focus.
		"""
		counts = self.pending_counts()
		for key, card in self.cards.items():
			card.set_images(self.images_for(key), counts.get(key, 0))
			card.set_counts()
		if self.mode == self.GRID:
			self._paint_grid()
		self.update_sidebar_stats()

	def pending_counts(self):
		out = {}
		for key, _seed, _wf in list(self.pending.values()):
			out[key] = out.get(key, 0) + 1
		return out

	def card_bg(self, card):
		"""Enabled and selected decide the card background, in one place."""
		if self.key_index.get(card.key) == self.selected:
			return CARD_ON
		return CARD if card.enabled else CARD_OFF

	# ------------------------------------------------------------- grid mode
	def toggle_mode(self):
		self.mode = self.GRID if self.mode == self.LIST else self.LIST
		self.view_btn.configure(text="cards" if self.mode == self.GRID else "grid")
		self.list_hint.configure(text=self.hint_text())
		self._thumb_cache.clear()
		self._thumb_order = []
		self.rebuild_cards()
		self.status(f"{self.mode} view")

	def _build_grid(self, keys):
		"""Every image as a thumbnail: the fastest way to find a winner."""
		cols = max(2, (self.card_w - 20) // (THUMB_W + 24))
		self.grid_cols = cols
		row = count = 0
		for key in keys:
			for path in self.images_for(key):
				cell = tk.Frame(self.cards_frame, bg=CARD, padx=6, pady=6,
								highlightthickness=1, highlightbackground=EDGE)
				cell.grid(row=row, column=count % cols, padx=6, pady=6, sticky="nw")
				count += 1
				if count % cols == 0:
					row += 1
				self.grid_cells[path] = cell
				self._fill_grid_cell(cell, key, path)
		if not count:
			tk.Label(self.cards_frame, text="no images yet - queue a prompt card first",
					 bg=BG, fg=FAINT, font=self.F(10)).grid(row=0, column=0,
															padx=14, pady=14)

	def _fill_grid_cell(self, cell, key, path):
		photo = self.thumb_photo(path)
		if photo is None:
			lbl = tk.Label(cell, text="?  (no preview)", bg=EDGE, fg=DIM,
						   width=22, height=6, font=self.F(8))
		else:
			lbl = tk.Label(cell, image=photo, bg=CARD, cursor="hand2")
			self._grid_photo[str(path)] = photo  # keep the master alive
		lbl.pack()
		slug = self.jobs[key]["slug"].split("__", 2)[-1]
		tk.Label(cell, text=slug, bg=CARD, fg=FG, font=self.F(8)).pack(anchor="w")
		tk.Label(cell, text=f"{self.jobs[key]['category']} · {path.name}",
				 bg=CARD, fg=FAINT, font=self.F(7)).pack(anchor="w")
		lbl.bind("<Button-1>", lambda e, k=key, p=path: self.open_viewer(k, p))

	def _paint_grid(self):
		"""A grid cell whose file is gone is dropped; nothing else repaints."""
		live = {p for key in self.visible_keys for p in self.images_for(key)}
		for path in [p for p in self.grid_cells if p not in live]:
			self.grid_cells.pop(path).destroy()
			self._grid_photo.pop(str(path), None)

	# ------------------------------------------------------- keyboard select
	def select_key(self, key):
		if key in self.visible_keys:
			self.selected = self.visible_keys.index(key)
			self._paint_selection(scroll=True)

	def step_selected(self, delta):
		if not self.visible_keys:
			return
		if self.selected < 0:
			self.selected = 0 if delta > 0 else len(self.visible_keys) - 1
		else:
			self.selected = (self.selected + delta) % len(self.visible_keys)
		self._paint_selection(scroll=True)

	def _paint_selection(self, scroll=False):
		target = (self.cards.get(self.visible_keys[self.selected])
				  if 0 <= self.selected < len(self.visible_keys) else None)
		for card in self.cards.values():
			card.paint_bg(self.card_bg(card))
			card.set_edge(ACCENT if card is target else EDGE)
		if target is not None and scroll:
			self._scroll_into_view(target)

	def _scroll_into_view(self, widget):
		region = self.canvas.bbox("all")
		if not region:
			return
		top, end = widget.winfo_y(), widget.winfo_y() + widget.winfo_height()
		view_top, view_h = self.canvas.canvasy(0), self.canvas.winfo_height()
		span = max(1, region[3] - region[1])
		if top < view_top:
			self.canvas.yview_moveto(max(0.0, top / span))
		elif end > view_top + view_h:
			self.canvas.yview_moveto(max(0.0, (end - view_h) / span))

	def open_selected(self):
		if self.selected < 0 or self.selected >= len(self.visible_keys):
			self.status("select a prompt with ↑ ↓ first")
			return
		key = self.visible_keys[self.selected]
		files = self.images_for(key)
		if not files:
			self.enqueue_variations(key)
			return
		self.open_viewer(key, self.newest(files))

	# ============================================================== sidebar
	def update_sidebar_stats(self):
		for name, (_var, lbl) in self.md_stats.items():
			keys = self.md_jobs.get(name, [])
			images = sum(len(self.images_for(k)) for k in keys)
			text = (f"{len(keys)} prompts · {images} images · "
					f"{sum(1 for k in keys if self.job_enabled(k))} enabled")
			if lbl.cget("text") != text:
				lbl.configure(text=text)
		for name, (var, lbl) in self.wf_stats.items():
			try:
				n = len(self.template(next(p for p in self.wf_paths if p.name == name)))
				text = f"{n} nodes · enabled" if var.get() else f"{n} nodes · disabled"
			except Exception:
				text = "(unreadable)" if var.get() else "disabled"
			if lbl.cget("text") != text:
				lbl.configure(text=text)
		total = sum(len(v) for v in self.files_by_key.values())
		note = f"{total} image{'s' if total != 1 else ''} on disk · {len(self.job_order)} prompts"
		if self.orphans:
			note += f"\n{self.orphans} file(s) match no prompt"
		note += ("\ncheckboxes are saved to state.toml on every change and on exit; "
				 "launch.py reads them too\nCtrl+Z restores the last deleted image")
		if self.side_note.cget("text") != note:
			self.side_note.configure(text=note)

	def update_server_label(self):
		self.server_lbl.configure(text=str(self.cfg("server")))

	# ================================================================ worker
	def _worker(self):
		last_ping = 0.0
		while not self._stop:
			server = str(self.cfg("server"))
			try:
				# 1) finish pending downloads
				for pid in list(self.pending):
					jkey, seed, workflow = self.pending[pid]
					try:
						entry = launch.get_history(server, pid)
					except Exception as e:
						fails = self.pending_fails.get(pid, 0) + 1
						self.pending_fails[pid] = fails
						if fails >= 120:
							self.pending.pop(pid, None)
							self.ev.put(("job_failed", pid, jkey,
										 " ".join(str(e).split())[:160]))
						continue
					if not entry:
						continue
					self.pending.pop(pid, None)
					status = (entry.get("status") or {}).get("status_str")
					if status == "error":
						self.ev.put(("job_failed", pid, jkey,
									 "ComfyUI reported an execution error"))
						continue
					imgs = []
					for node_out in (entry.get("outputs") or {}).values():
						imgs.extend(launch.core.output_files(node_out))
					if not imgs:
						self.ev.put(("job_failed", pid, jkey,
									 "job finished but saved no image"))
						continue
					saved = self._worker_download(server, jkey, seed, imgs, workflow)
					if saved:
						self.ev.put(("downloaded", jkey, saved))
				# 2) rescan the output dir
				scan = self.scan_output()
				if scan != self._last_scan:
					self._last_scan = scan
					self.ev.put(("rescan", scan))
				# 3) ping the server and read the queue depth
				if time.time() - last_ping >= 5:
					last_ping = time.time()
					self.ev.put(("server",) + self._ping(server))
			except Exception:
				pass
			time.sleep(1.0)

	def _worker_download(self, server, jkey, seed, imgs, workflow):
		stem = self.jobs[jkey]["slug"].replace(" ", "_")
		saved = []
		for i, info in enumerate(imgs):
			ext = Path(info["filename"]).suffix or ".png"
			suffix = "" if len(imgs) == 1 else f"_{i + 1}"
			out = OUTPUT_DIR / f"{stem}__s{seed}__{workflow}{suffix}{ext}"
			if out.exists():
				continue
			try:
				launch.download_image(server, info, out)
				saved.append(out.name)
			except Exception:
				pass
		return saved

	def _ping(self, server):
		try:
			launch.http(f"{server}/system_stats", timeout=4)
			try:
				q = json.loads(launch.http(f"{server}/queue", timeout=4))
				run = len(q.get("queue_running") or [])
				pend = len(q.get("queue_pending") or [])
			except Exception:
				run = pend = -1
			return (True, run, pend)
		except Exception:
			return (False, 0, 0)

	# ================================================================= drain
	def _drain(self):
		try:
			while True:
				self._handle_event(self.ev.get_nowait())
		except queue.Empty:
			pass
		# one insert per drain tick: a slow batch must not wait for 200 lines
		if self.batch_win is not None and self.batch_win.winfo_exists():
			self.batch_win.flush()
		if not self._stop:
			self.after(150, self._drain)

	def _handle_event(self, item):
		kind = item[0]
		if kind == "rescan":
			self.index_scan(item[1])
			self.sync_cards()
		elif kind == "downloaded":
			_, jkey, names = item
			slug = self.jobs.get(jkey, {}).get("slug", jkey)
			self.status(f"saved {', '.join(names)} - new image in {slug}'s card")
		elif kind == "job_failed":
			_, _pid, jkey, msg = item
			slug = self.jobs.get(jkey, {}).get("slug", jkey)
			self.status(f"job failed for '{slug}': {msg}")
		elif kind == "server":
			_, ok, run, pend = item
			was = self.server_ok
			self.server_ok = ok
			self.server_dot.configure(
				text=f"\u25cf {'online' if ok else 'offline'}  ·  "
					 f"{str(self.cfg('server')).replace('http://', '')}",
				fg=GOOD if ok else BAD)
			self.queue_lbl.configure(text="queue ?" if pend < 0
									 else f"queue: {run} running · {pend} pending")
			self.pend_lbl.configure(text=f"downloading: {len(self.pending)} job(s)")
			if was is None and not ok:
				self.status("ComfyUI is not reachable - start it, then "
							"check the URL in Settings")
		elif kind == "batch_line":
			if self.batch_win and self.batch_win.winfo_exists():
				self.batch_win.append(item[1])
		elif kind == "batch_done":
			code = item[1]
			if self.batch_win and self.batch_win.winfo_exists():
				self.batch_win.append(f"--- launcher exited (code {code}) ---")
				self.batch_win.flush()
				self.batch_win.stop_btn.configure(state="disabled")
			self.status(f"batch finished (exit code {code})"
						+ ("" if code == 0 else " - launch.py's reason is in the batch log"))

	# ============================================================== closing
	def status(self, msg):
		msg = str(msg)
		if len(msg) > 160:
			msg = msg[:157] + "..."
		self.status_lbl.configure(text=msg)

	def _on_close(self):
		self._stop = True
		try:
			self.st["app"]["variations"] = int(self.spin_var.get())
		except Exception:
			pass
		self.save_state_now()
		self.destroy()


def main():
	app = App()
	if not app.md_paths and not app.wf_paths:
		app.after(600, lambda: messagebox.showwarning(
			"nothing found",
			"No prompt files or workflow templates were found. "
			"Check the selected project JSON."))
	app.mainloop()


if __name__ == "__main__":
	main()
