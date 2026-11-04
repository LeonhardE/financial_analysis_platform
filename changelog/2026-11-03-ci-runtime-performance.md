# Reduce CI wait time without dropping validation

Date: 2026-11-03

## Summary

Reduce the Agent Hub and Terraform critical paths through bounded parallel execution, and avoid full application validation for ownership-only changes.

## Changes

- Run Agent Hub CI tests in four isolated processes, preserving module/class fixtures and checking the combined test discovery manifest. Empty, entirely skipped, failed, or incomplete executions fail the job.
- Run independent Terraform compatibility scenarios concurrently with separate temporary roots and localhost fixtures; retain all scenarios and their failure propagation.
- Treat only the exact `.github/CODEOWNERS` path as a repository-only change. Workflow, executable, unknown, and mixed changes retain their checks.
- Keep the required Quality checks gate, image builds, isolated health checks, branch protection, and cloud execution controls.

## Validation

- Full root `npm run check` passed, including the complete 498-test Agent Hub suite and the runner regression tests.
- Both real-provider localhost compatibility groups passed with four workers: five provider scenarios and five ownership scenarios.
