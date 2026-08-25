"""
Modular API route packages, each exposing a `register(...)` factory that
returns an APIRouter to be mounted on the main /api router in server.py.

Kept intentionally thin: business logic still lives in server.py for shared
helpers.  Only fully self-contained sections (RDW, KvK, Reminders, Cron)
are extracted here to keep server.py maintainable without the risk of
touching auth / invoices / repairs core paths.
"""
