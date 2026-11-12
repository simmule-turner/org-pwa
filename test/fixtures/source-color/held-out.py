import os, sys
from collections import defaultdict as dd
from typing import Optional, List

CONST_LIMIT = 0x1F + 1_000

class Account(Base, metaclass=Meta):
    """Holds a balance."""
    rate: float = 0.05

    def __init__(self, owner: str, *args, **kwargs) -> None:
        super().__init__()
        self.owner = owner
        self._balance = 0

    @property
    def balance(self) -> int:
        return self._balance

    @staticmethod
    async def fetch(url, timeout=3.5):
        async with session.get(url) as r:
            data = await r.json()
        return [x for x in data if x is not None and not x.hidden]

def main(argv: List[str]) -> int:
    total = 0
    for i, name in enumerate(argv):
        if name.startswith("--") or name in ('-h', "-v"):
            continue
        try:
            total += int(name) ** 2 // 3 % 4
        except (ValueError, TypeError) as exc:
            print(f"bad {name!r}: {exc}", file=sys.stderr)
            raise SystemExit(1) from exc
        finally:
            pass
    lam = lambda a, b=2: a if a > b else b
    return total  # done

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
