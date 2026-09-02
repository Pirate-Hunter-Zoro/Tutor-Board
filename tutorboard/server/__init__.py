"""The board itself: an HTTP server, its routes, and the two workers behind it.

One payload built once and pushed to every browser that has the board open, a
TikZ compiler that runs off the request thread, and a handler that is mostly a
table of paths.
"""
