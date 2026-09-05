from datetime import date, timedelta

from app.models.attendance import AttendanceLog
from app.models.comp_off import CompOffTransaction
from app.models.leave import LeaveRequest


def get_comp_off_leave_dates(db, user_id, year: int, month: int) -> set[date]:
    """Return approved leave dates covered by a used comp-off transaction."""
    month_start = date(year, month, 1)
    next_month = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    month_end = next_month - timedelta(days=1)

    leaves = db.query(LeaveRequest).filter(
        LeaveRequest.user_id == user_id,
        LeaveRequest.status == "approved",
        LeaveRequest.start_date <= month_end,
        LeaveRequest.end_date >= month_start,
    ).order_by(LeaveRequest.start_date, LeaveRequest.created_at).all()
    transactions = db.query(CompOffTransaction).filter(
        CompOffTransaction.user_id == user_id,
        CompOffTransaction.type == "used_leave",
    ).order_by(CompOffTransaction.reference_date, CompOffTransaction.created_at).all()

    used_transaction_ids = set()
    covered_dates = set()
    for leave in leaves:
        transaction = next(
            (
                row for row in transactions
                if row.id not in used_transaction_ids
                and row.reference_date == leave.start_date
                and float(row.amount or 0) > 0
            ),
            None,
        )
        if not transaction:
            continue

        used_transaction_ids.add(transaction.id)
        covered_days = min(
            int(float(transaction.amount)),
            (leave.end_date - leave.start_date).days + 1,
        )
        for offset in range(max(0, covered_days)):
            covered_date = leave.start_date + timedelta(days=offset)
            if month_start <= covered_date <= month_end:
                covered_dates.add(covered_date)

    return covered_dates


def materialize_comp_off_leave(db, leave, covered_days: int) -> None:
    """Make future dashboard/report reads see approved comp-off leave."""
    for offset in range(max(0, int(covered_days))):
        leave_date = leave.start_date + timedelta(days=offset)
        attendance = db.query(AttendanceLog).filter(
            AttendanceLog.user_id == leave.user_id,
            AttendanceLog.date == leave_date,
        ).first()
        if not attendance:
            db.add(AttendanceLog(
                user_id=leave.user_id,
                date=leave_date,
                day_status="comp_off_leave",
                total_hours=0,
            ))
        elif attendance.day_status in (None, "absent"):
            attendance.day_status = "comp_off_leave"
