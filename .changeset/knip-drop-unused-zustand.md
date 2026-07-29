---
"paperlab": patch
---

Drop `zustand` from the library's dependencies — it was never imported by the package (only the editor app uses it), so consumers no longer download it. Also removed two stale internal re-exports left over from the field/ module split.
