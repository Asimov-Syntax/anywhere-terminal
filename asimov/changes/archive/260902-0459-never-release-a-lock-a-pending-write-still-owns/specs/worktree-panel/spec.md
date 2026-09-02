# worktree-panel Specification Delta

## ADDED Requirements

### Requirement: A dirty port-write timeout retains serialization

WHEN a port-claim deadline expires while lock acquisition or a protected mutation may still land, the selected uncommitted ports SHALL fail, the cross-process lock SHALL remain or become held, and the panel SHALL warn that cleanup is required.

### Requirement: A clean port-write timeout releases serialization

WHEN a port-claim deadline expires with no protected mutation in flight, the selected uncommitted ports SHALL fail and the cross-process lock SHALL be released.

### Requirement: An expired port write starts no later publication

After a port-claim deadline expires, the extension SHALL NOT begin another claim publication in that transaction. Inode-owned temporary and lock cleanup MAY still complete afterward when they cannot alter the committed target or release a successor.

### Requirement: Successful work remains successful when cleanup is late

WHERE a port claim committed before inode-owned temporary cleanup or lock release exceeded its bound, the committed outcome SHALL remain successful and the panel SHALL identify the incomplete cleanup.
