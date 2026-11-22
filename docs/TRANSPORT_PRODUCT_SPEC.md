# Campus Transport product specification

Status: architecture proposal. Transport routes and operational controls will enter navigation after their permissions and workflows work.

Student workspace: start with assigned route, direction, boarding stop, scheduled pickup, ordered stops, trip status and relevant alerts. Show scheduled and predicted arrivals distinctly. Display source and observation time for occupancy and position. Provide explicit states for no assignment, scheduled only, disconnected, stale, cancelled and completed. Put the text route and timing before a lazy-loaded map. Stop preference is restricted to the eligible route. Reminders and inaccurate-information reporting require functional notification and support paths.

Operations: a scoped administrator manages routes, stop order, schedules, vehicles, device bindings, operators and alerts. An assigned dispatcher or conductor can prepare/start, record arrival/departure or disruption, record a passenger count, and complete a trip while stationary. Actual arrival events and aggregate counts are useful before GPS integration. Driver interaction during driving and disclosure of personal contact or passenger data are excluded from the design.

Pilot source order: validate the existing tracker and contract first. A dedicated tracker improves independent availability but requires installation, power and a data plan. A managed transport smartphone may work with approved background location permissions and operational ownership. Treat browser GPS as a foreground demonstration aid. A trusted vendor integration can reduce device management at the cost of API availability, data rights and quotas. Evaluate Traccar for supported hardware, scoped account access and normalized position data. [Traccar API](https://www.traccar.org/api-reference/)

Demo records use fictional equipment, trips and a deterministic trace with a visible **Simulated** label. Real tracking requires documented institutional authorization, an approved device/feed and access controls. Scheduled-only service remains valuable if live data is unavailable.
