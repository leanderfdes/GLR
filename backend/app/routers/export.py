from collections import defaultdict
import calendar
from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime, date
import pandas as pd
import os
from typing import Optional

from app.core.database import get_db
from app.core.security import require_admin_or_superadmin
from app.models.user import User
from app.models.attendance import AttendanceLog, AttendanceInterval
from app.models.company import Location
from app.models.holiday import Holiday
from app.models.working_days import WorkingDaysConfig
from app.services.gps_service import calculate_distance_meters
from app.services.leave_service import get_comp_off_leave_dates
from app.routers.payroll import get_employee_monthly_salary, is_user_expected_working_day
from app.utils.timezone import now_ist

router = APIRouter(
    prefix="/export",
    tags=["Export"]
)


@router.get("/attendance/xlsx")
def export_attendance_excel(
    query_date: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    employee_id: Optional[str] = Query(None),
    current_user: User = Depends(require_admin_or_superadmin),
    db: Session = Depends(get_db)
):
    query = db.query(
        AttendanceLog,
        User
    ).join(
        User,
        AttendanceLog.user_id == User.id
    )

    if query_date:
        try:
            parsed_date = datetime.strptime(query_date, "%Y-%m-%d").date()
            query = query.filter(AttendanceLog.date == parsed_date)
        except ValueError:
            pass
    elif year and month:
        import calendar
        num_days = calendar.monthrange(year, month)[1]
        query = query.filter(
            AttendanceLog.date >= date(year, month, 1),
            AttendanceLog.date <= date(year, month, num_days)
        )
    elif year:
        query = query.filter(
            AttendanceLog.date >= date(year, 1, 1),
            AttendanceLog.date <= date(year, 12, 31)
        )

    if employee_id:
        from uuid import UUID
        is_uuid = False
        try:
            UUID(employee_id)
            is_uuid = True
        except ValueError:
            pass

        if is_uuid:
            query = query.filter(
                (User.employee_id == employee_id) | (User.id == employee_id)
            )
        else:
            query = query.filter(User.employee_id == employee_id)

    records = query.order_by(
        AttendanceLog.date.desc(),
        AttendanceLog.checkin_time.desc()
    ).all()

    locations = db.query(Location).all()
    data = []

    for attendance, user in records:
        matched_location = None
        if attendance.checkin_lat is not None and attendance.checkin_lng is not None:
            # Look up matching location name by coordinate distance
            for loc in locations:
                dist = calculate_distance_meters(
                    attendance.checkin_lat,
                    attendance.checkin_lng,
                    loc.latitude,
                    loc.longitude
                )
                if dist <= loc.radius_meters + 10:  # 10m GPS offset margin
                    matched_location = loc.name
                    break
            
            # Fallback to closest zone name if none matched geofence exactly
            if not matched_location and locations:
                closest_loc = min(
                    locations,
                    key=lambda l: calculate_distance_meters(
                        attendance.checkin_lat,
                        attendance.checkin_lng,
                        l.latitude,
                        l.longitude
                    )
                )
                matched_location = closest_loc.name

        data.append({
            "Employee ID": user.employee_id,
            "Employee Name": user.name,
            "Email": user.email,
            "Date": attendance.date,
            "Check-in Time": attendance.checkin_time,
            "Check-out Time": attendance.checkout_time,
            "Check-in Status": attendance.checkin_status,
            "Check-out Status": attendance.checkout_status,
            "Total Hours": attendance.total_hours,
            "Day Status": attendance.day_status,
            "Location Zone": matched_location or "Remote",
            "Check-in Latitude": attendance.checkin_lat,
            "Check-in Longitude": attendance.checkin_lng,
            "Check-out Latitude": attendance.checkout_lat,
            "Check-out Longitude": attendance.checkout_lng
        })

    df = pd.DataFrame(data)

    os.makedirs("exports", exist_ok=True)

    file_name = f"attendance_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    file_path = os.path.join("exports", file_name)

    # Prevent empty list exception inside pandas Excel writer
    if df.empty:
        df = pd.DataFrame(columns=[
            "Employee ID", "Employee Name", "Email", "Date", "Check-in Time", "Check-out Time",
            "Check-in Status", "Check-out Status", "Total Hours", "Day Status", "Location Zone",
            "Check-in Latitude", "Check-in Longitude", "Check-out Latitude", "Check-out Longitude"
        ])

    with pd.ExcelWriter(file_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Attendance Report")

        worksheet = writer.sheets["Attendance Report"]

        for column_cells in worksheet.columns:
            max_length = 0
            column_letter = column_cells[0].column_letter

            for cell in column_cells:
                if cell.value:
                    max_length = max(max_length, len(str(cell.value)))

            worksheet.column_dimensions[column_letter].width = max_length + 3

    return FileResponse(
        path=file_path,
        filename=file_name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


def _interval_seconds(checkin_time, checkout_time) -> float:
    """Return safe elapsed seconds for timestamps from either DB timezone mode."""
    if not checkin_time or not checkout_time:
        return 0.0

    if checkin_time.tzinfo:
        checkin_time = checkin_time.replace(tzinfo=None)
    if checkout_time.tzinfo:
        checkout_time = checkout_time.replace(tzinfo=None)

    return max(0.0, (checkout_time - checkin_time).total_seconds())


def _hours_and_hhmm(total_seconds: float) -> tuple[float, str]:
    rounded_seconds = int(round(max(0.0, total_seconds)))
    total_minutes = int(round(rounded_seconds / 60))
    hours, minutes = divmod(total_minutes, 60)
    return round(rounded_seconds / 3600, 2), f"{hours}:{minutes:02d}"


@router.get("/attendance/summary/xlsx")
def export_attendance_summary_excel(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    employee_id: Optional[str] = Query(None),
    current_user: User = Depends(require_admin_or_superadmin),
    db: Session = Depends(get_db)
):
    """Export one monthly attendance/payroll summary row per employee."""
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    report_end = min(month_end, now_ist().date())

    working_days_cfg = db.query(WorkingDaysConfig).first()
    days_map = [True, True, True, True, True, True, False]
    if working_days_cfg:
        days_map = [
            working_days_cfg.monday,
            working_days_cfg.tuesday,
            working_days_cfg.wednesday,
            working_days_cfg.thursday,
            working_days_cfg.friday,
            working_days_cfg.saturday,
            working_days_cfg.sunday,
        ]

    holiday_rows = db.query(Holiday).filter(
        Holiday.date >= month_start,
        Holiday.date <= month_end,
    ).all()
    holiday_dates = {holiday.date for holiday in holiday_rows}

    employee_query = db.query(User).filter(User.email != "admin@glrattendance.com")
    if employee_id:
        from uuid import UUID

        try:
            UUID(employee_id)
            employee_query = employee_query.filter(
                (User.employee_id == employee_id) | (User.id == employee_id)
            )
        except ValueError:
            employee_query = employee_query.filter(User.employee_id == employee_id)

    employees = employee_query.order_by(User.name).all()
    employee_ids = [employee.id for employee in employees]

    logs = []
    if employee_ids:
        logs = db.query(AttendanceLog).filter(
            AttendanceLog.user_id.in_(employee_ids),
            AttendanceLog.date >= month_start,
            AttendanceLog.date <= month_end,
        ).all()

    logs_by_employee = defaultdict(list)
    log_ids = []
    for log in logs:
        logs_by_employee[log.user_id].append(log)
        log_ids.append(log.id)

    interval_seconds_by_log = defaultdict(float)
    interval_log_ids = set()
    if log_ids:
        intervals = db.query(AttendanceInterval).filter(
            AttendanceInterval.attendance_log_id.in_(log_ids),
        ).all()
        for interval in intervals:
            interval_log_ids.add(interval.attendance_log_id)
            interval_seconds_by_log[interval.attendance_log_id] += _interval_seconds(
                interval.checkin_time,
                interval.checkout_time,
            )

    rows = []
    for employee in employees:
        employee_logs = logs_by_employee.get(employee.id, [])
        logs_by_date = {log.date: log for log in employee_logs}
        comp_off_leave_dates = get_comp_off_leave_dates(db, employee.id, year, month)

        expected_dates = []
        target_seconds = 0.0
        for day_num in range(1, month_end.day + 1):
            current_date = date(year, month, day_num)
            if current_date > report_end:
                continue
            if not is_user_expected_working_day(
                current_date,
                employee.saturday_policy or "alt_sat_holiday",
                holiday_dates,
                days_map,
            ):
                continue

            expected_dates.append(current_date)
            expected_full_hours = (
                6.5
                if current_date.weekday() == 5 and employee.saturday_policy == "all_sat_half_day"
                else 8.5
            )
            target_seconds += expected_full_hours * 3600

        full_days = half_days = absent_days = present_days = paid_leave_days = 0
        total_deductions = extra_days_worked = 0.0

        for current_date in expected_dates:
            log = logs_by_date.get(current_date)
            if log and log.day_status in ["full_day", "holiday_work"]:
                full_days += 1
                present_days += 1
            elif log and log.day_status == "half_day":
                half_days += 1
                present_days += 1
                total_deductions += 0.5
            elif current_date in comp_off_leave_dates or (log and log.day_status == "comp_off_leave"):
                paid_leave_days += 1
            elif log and log.day_status == "absent":
                absent_days += 1
                total_deductions += 1.0
            elif not log:
                absent_days += 1
                total_deductions += 1.0

        for log in employee_logs:
            if log.date in expected_dates:
                continue
            if log.day_status in ["full_day", "holiday_work"]:
                present_days += 1
                full_days += 1
                extra_days_worked += 1.0
            elif log.day_status == "half_day":
                present_days += 1
                half_days += 1
                extra_days_worked += 0.5
            elif log.day_status == "comp_off_leave" or log.date in comp_off_leave_dates:
                paid_leave_days += 1

        total_seconds = sum(
            interval_seconds_by_log.get(log.id, 0.0)
            for log in employee_logs
        )
        total_seconds += sum(
            (log.total_hours or 0.0) * 3600
            for log in employee_logs
            if log.id not in interval_log_ids
        )
        total_hours, total_hours_hhmm = _hours_and_hhmm(total_seconds)
        total_paid_days = max(0.0, 30.0 - total_deductions + extra_days_worked)
        base_salary = get_employee_monthly_salary(
            db,
            employee.id,
            year,
            month,
            employee.base_salary,
        )
        calculated_salary = (
            ((base_salary / 30.0) * total_paid_days) * 0.99
            if base_salary > 0
            else 0.0
        )

        rows.append({
            "name": employee.name,
            "total no of days": len(expected_dates),
            "total target hours": round(target_seconds / 3600, 2),
            "no of days present": present_days,
            "no of days full day": full_days,
            "half day": half_days,
            "absent": absent_days,
            "paid leave / comp-off": paid_leave_days,
            "no. holidays in month": len(holiday_dates),
            "total hours worked": total_hours,
            "total hours worked (HH:MM)": total_hours_hhmm,
            "total salary calculated": round(calculated_salary, 2),
        })

    columns = [
        "name",
        "total no of days",
        "total target hours",
        "no of days present",
        "no of days full day",
        "half day",
        "absent",
        "paid leave / comp-off",
        "no. holidays in month",
        "total hours worked",
        "total hours worked (HH:MM)",
        "total salary calculated",
    ]
    df = pd.DataFrame(rows, columns=columns)

    os.makedirs("exports", exist_ok=True)
    file_name = f"attendance_report_{year}_{month:02d}.xlsx"
    file_path = os.path.join("exports", file_name)

    with pd.ExcelWriter(file_path, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Attendance Summary")
        worksheet = writer.sheets["Attendance Summary"]
        worksheet.freeze_panes = "A2"
        worksheet.auto_filter.ref = worksheet.dimensions
        for cell in worksheet[1]:
            cell.font = cell.font.copy(bold=True)
        for column_cells in worksheet.columns:
            column_letter = column_cells[0].column_letter
            max_length = max(len(str(cell.value or "")) for cell in column_cells)
            worksheet.column_dimensions[column_letter].width = min(max_length + 3, 32)

    return FileResponse(
        path=file_path,
        filename=file_name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
