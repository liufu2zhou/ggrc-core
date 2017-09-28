# Copyright (C) 2017 Google Inc.
# Licensed under http://www.apache.org/licenses/LICENSE-2.0 <see LICENSE file>

"""
update monthly wfs

Create Date: 2017-09-26 12:50:29.595921
"""
# disable Invalid constant name pylint warning for mandatory Alembic variables.
# pylint: disable=invalid-name

import collections
import datetime
from dateutil import relativedelta

from alembic import op

from ggrc_workflows.services import google_holidays


# revision identifiers, used by Alembic.
revision = '3ea1293a93bb'
down_revision = '3ebe14ae9547'

MONTHLY_SQL = (
    'select w.id, t.id, t.relative_start_day, t.relative_end_day, '
    'max(COALESCE(ct.start_date, CURDATE())) from workflows as w '
    'join task_groups as tg on tg.workflow_id = w.id '
    'join task_group_tasks as t on t.task_group_id = tg.id '
    'left join cycle_task_group_object_tasks as ct '
    'on ct.task_group_task_id = t.id '
    'where w.frequency = "monthly" group by 1,2;'
)

UPDATE_TASKS_SQL = (
    "update task_group_tasks "
    "set start_date='{start_date}', "
    "end_date='{end_date}' "
    "where id in ({ids})"
)

UPDATE_WF_SQL = (
    "update workflows "
    "set repeat_multiplier='{repeat_multiplier}', "
    "next_cycle_start_date='{next_cycle_start_date}' "
    "where id = {id}"
)

MONTH = 8
YEAR = 2017


def upgrade():
  """Upgrade database schema and/or data, creating a new revision."""
  # pylint: disable=too-many-locals
  ctg_wf = collections.defaultdict(set)
  tg_dates_dict = {}
  tg_wf = collections.defaultdict(set)
  holidays = google_holidays.GoogleHolidays()
  for row in op.get_bind().execute(MONTHLY_SQL):
    wf, tgt, start_day, end_day, last_task_start_date = row
    if not (start_day and end_day):
      continue
    tg_wf[wf].add(tgt)
    ctg_wf[wf].add(last_task_start_date)
    tg_dates_dict[tgt] = (start_day, end_day)

  today = datetime.date.today()
  group_days = collections.defaultdict(set)
  for wf, task_ids in tg_wf.iteritems():
    start_dates = []
    for task_id in task_ids:
      start_date, end_date = [datetime.date(YEAR, MONTH, d)
                              for d in tg_dates_dict[task_id]]
      start_dates.append(start_date)
      if end_date < start_date:
        end_date += relativedelta.relativedelta(end_date, months=1)
      group_days[(start_date, end_date)].add(task_id)
    startup_next_cycle_start_date = min(start_dates)
    next_cycle_start_date = startup_next_cycle_start_date
    repeat_multiplier = 0
    last_cycle_started_date = max([min(ctg_wf[wf]), today])
    while next_cycle_start_date <= last_cycle_started_date:
      repeat_multiplier += 1
      next_cycle_start_date = (
          startup_next_cycle_start_date + relativedelta.relativedelta(
              startup_next_cycle_start_date,
              months=repeat_multiplier))
      while (next_cycle_start_date.isoweekday() > 5 or
             next_cycle_start_date in holidays):
        next_cycle_start_date -= relativedelta.relativedelta(days=1)
    op.execute(
        UPDATE_WF_SQL.format(repeat_multiplier=repeat_multiplier,
                             next_cycle_start_date=next_cycle_start_date,
                             id=wf)
    )
  for days, task_ids in group_days.iteritems():
    start_date, end_date = days
    op.execute(
        UPDATE_TASKS_SQL.format(start_date=start_date,
                                end_date=end_date,
                                ids=", ".join(str(i) for i in task_ids))
    )


def downgrade():
  """Downgrade database schema and/or data back to the previous revision."""
  pass