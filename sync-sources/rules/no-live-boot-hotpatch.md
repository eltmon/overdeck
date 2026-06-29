---
scope: dev
---
### Never hot-patch a dashboard boot-path change onto the live server

Dashboard boot-path changes must be runtime-boot-tested before they run on
the live server. Typecheck and unit tests do NOT exercise the Effect Layer
bootstrap, so a green static check is not evidence that a boot-path change
boots.

Use a throwaway instance or workspace pipeline to validate the boot. When
restarting, use `pan restart --health-timeout` of at least 120s so a healthy
but slow boot is not false-failed. Never restart the live server into an
untested boot-path change.
