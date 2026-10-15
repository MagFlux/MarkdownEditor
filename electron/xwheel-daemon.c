/**
 * xwheel-daemon — capture wheel notches GLOBALLY via XI2 raw device events
 * and forward them as one status line to stdout:
 *
 *     btn=<4|5> inside=<0|1> x=<rootx> y=<rooty>
 *
 * whenever a wheel press happens while the pointer is inside the target
 * window (argv[1]; a decimal X11 Window id supplied by the Electron shell).
 *
 * WHY RAW EVENTS (the WSLg wheel saga): the X server delivers every wheel
 * notch, but Chromium's X11 decode discards real-wheel deltas before the DOM
 * (upstream 496255940 deferral + 41249467), while SYNTHETIC clicks decode
 * fine — so the shell injects each real notch back as a synthetic wheel via
 * webContents.sendInputEvent. The first capture mechanism (X Record,
 * delivered core events) turned out BLIND to anything over a Chromium
 * window: Chromium selects XI2 events only, so no core ButtonPress is ever
 * "delivered" over its window — Record saw nothing. XI2 raw events are
 * broadcast to every subscriber INDEPENDENT of which client receives the
 * event normally, solving exactly that. Coordinates are not in raw events,
 * so the current pointer position is queried at handling time, and the
 * pointer's window-subtree target check (XQueryPointer + XQueryTree walk)
 * gates the report to the app window.
 *
 * Usage: xwheel-daemon <target-window-id-decimal>
 * Exits when XI2 is unavailable; the shell tolerates that (no boost beyond
 * what Chromium itself surfaces).
 */
#include <X11/Xlib.h>
#include <X11/extensions/XInput2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static unsigned long gTargetWindow = 0;
static Display *gDpy = NULL;

/* ignore_x_errors — Xlib's default error handler EXITS the process on any
   protocol error (e.g. a BadWindow race in XQueryTree when a transient child
   window is destroyed between queries — observed as a silent mid-session
   daemon death). The capture must never die; skip errors and keep running. */
static int ignore_x_errors(Display *d, XErrorEvent *e)
{
	(void)d;
	(void)e;
	return 0;
}

/* isDescendant — True when `w` is `target` or sits inside its subtree. The
   pointer under the app lands on Chromium's internal child X windows (the
   Electron native handle is the content window, a CHILD of the visible
   shell), so an exact-id comparison can miss; walk the ancestry instead. */
static Bool isDescendant(Display *d, Window w, Window target)
{
	Window root = None, parent = None, *kids = NULL;
	unsigned int n = 0;
	int depth = 0;
	while (w && depth < 64) {
		if (w == target)
			return True;
		if (!XQueryTree(d, w, &root, &parent, &kids, &n))
			return False;
		if (kids && n) XFree(kids);
		kids = NULL;
		if (parent == root || !parent)
			return False;
		w = parent;
		depth++;
	}
	return False;
}

int main(int argc, char **argv)
{
	if (argc < 2) {
		fprintf(stderr, "usage: xwheel-daemon <target-window-id>\n");
		return 1;
	}
	gTargetWindow = strtoul(argv[1], NULL, 10);
	if (!gTargetWindow) {
		fprintf(stderr, "xwheel-daemon: invalid target window id\n");
		return 1;
	}
	gDpy = XOpenDisplay(NULL);
	if (!gDpy) {
		fprintf(stderr, "xwheel-daemon: no X display\n");
		return 2;
	}
	int major = 2, minor = 0;
	XSetErrorHandler(ignore_x_errors);
	if (XIQueryVersion(gDpy, &major, &minor) != Success) {
		fprintf(stderr, "xwheel-daemon: XI2 unsupported\n");
		return 3;
	}

	/* Subscribe to raw button events from every master device: unlike normal
	   delivery, raw events reach all subscribers regardless of which window
	   picks the input up, so they see input going to Chromium's windows. */
	unsigned char mask_bits[XIMaskLen(XI_RawButtonPress)];
	memset(mask_bits, 0, sizeof(mask_bits));
	XISetMask(mask_bits, XI_RawButtonPress);
	XIEventMask mask;
	mask.deviceid = XIAllMasterDevices;
	mask.mask_len = sizeof(mask_bits);
	mask.mask = mask_bits;
	XISelectEvents(gDpy, DefaultRootWindow(gDpy), &mask, 1);
	XFlush(gDpy);

	for (;;) {
		XEvent ev;
		XNextEvent(gDpy, &ev);
		if (ev.xcookie.type != GenericEvent)
			continue;
		if (!XGetEventData(gDpy, &ev.xcookie))
			continue;
		if (ev.xcookie.evtype == XI_RawButtonPress && ev.xcookie.data) {
			XIRawEvent *raw = (XIRawEvent *)ev.xcookie.data;
			int button = raw->detail;
			if (button == 4 || button == 5) {
				/* Descend to the DEEPEST window under the pointer:
				   XQueryPointer on the root gives only the first-level
				   child; its child_return walks one level at a time. */
				Window root = DefaultRootWindow(gDpy), cur = None, child = None;
				int rx = 0, ry = 0, wx = 0, wy = 0;
				unsigned int st = 0;
				Bool ok = XQueryPointer(gDpy, root, &root, &child,
						&rx, &ry, &wx, &wy, &st);
				cur = child ? child : root;
				while (ok && child) {
					Window next = None;
					cur = child;
					ok = XQueryPointer(gDpy, cur, &root, &next,
							&rx, &ry, &wx, &wy, &st);
					child = next;
				}
				int inside = ok && isDescendant(gDpy, cur, gTargetWindow);
				printf("btn=%d inside=%d x=%d y=%d t=%lu dev=%d\n",
					button, inside, rx, ry, (unsigned long)raw->time, raw->deviceid);
				fflush(stdout);
			}
		}
		XFreeEventData(gDpy, &ev.xcookie);
	}
	return 0;
}
