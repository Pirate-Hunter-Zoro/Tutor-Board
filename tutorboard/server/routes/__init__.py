"""The board's routes, one module per family of paths.

The Handler used to be nine hundred lines of `if path == ...`, which is a table
pretending to be a function: to find out what `/switch` did you read past
everything else first, and adding a route meant editing the same enormous method
everybody else was editing.

Each module here answers for one family and says whether it took the request.
`NOT_MINE` is that answer, and it is a sentinel rather than `False` because a
route that handled a request returns whatever `send_json` returned, which is
`None` -- and `None` cannot mean both "handled" and "not mine".
"""

NOT_MINE = object()
