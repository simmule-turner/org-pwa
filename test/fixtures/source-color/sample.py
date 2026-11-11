#!/usr/bin/env python
# a comment
import os, sys
from typing import List

CONST = 10
@decorator
def add(a: int, b=2.5e3, *args, **kw) -> int:
    """Docstring
    over lines."""
    s = 'single' + "double \"q\" \n" + f"f{a}" + r"raw" + b"bytes"
    if a is not None and not b or True:
        print(len(s), 0x1F, 0b101, 1_000, 3j)
    elif False:
        pass
    for i in range(10):
        yield i
    try:
        raise ValueError("x")
    except (KeyError, TypeError) as e:
        return lambda x: x
    finally:
        del s
    return self.value

class Foo(Base, metaclass=Meta):
    attr = None
    async def go(self):
        await self.run()
        with open("f") as fh:
            global CONST
        assert isinstance(self, Foo)
