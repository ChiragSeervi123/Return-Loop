"""Customer pages: orders, new return, scheduling, tracking."""
from datetime import date

from flask import (Blueprint, abort, flash, redirect, render_template, request,
                   url_for)

from blueprints import current_customer, guard
from config import (COMMENT_MAX_CHARS, MAX_PICKUP_ATTEMPTS, PICKUP_SLOTS,
                    RETURN_REASONS, RETURN_WINDOW_DAYS, SLOT_HOURS, STAFF)
from models import Order, OrderItem, ReturnRequest, db
from services.eligibility import check_eligibility, days_left
from services.returns import (WorkflowError, close_return, create_return,
                              pickup_dates, schedule_pickup)
from services.state_machine import (InvalidTransition, TERMINAL, TRACK_STEPS,
                                    step_index)
from services.uploads import UploadError, save_photo

bp = Blueprint("customer", __name__, url_prefix="/customer")
bp.before_request(guard("customer"))


def _own_return(code):
    """Fetch a return by code; 404 if it does not exist or is not this customer's."""
    ret = ReturnRequest.query.filter_by(return_code=code).first()
    if ret is None or ret.customer_id != current_customer().id:
        abort(404)
    return ret


@bp.get("/orders")
def orders():
    customer = current_customer()
    order_list = (Order.query.filter_by(customer_id=customer.id)
                  .order_by(Order.delivered_at.desc()).all())
    cards = []
    for order in order_list:
        for item in order.items:
            ok, why = check_eligibility(item)
            cards.append({"order": order, "item": item, "ok": ok, "why": why,
                          "days_left": days_left(item)})
    return render_template("customer/orders.html", cards=cards, window=RETURN_WINDOW_DAYS)


@bp.route("/return/new", methods=["GET", "POST"])
def new_return():
    customer = current_customer()
    item = db.session.get(OrderItem, request.args.get("item", type=int) or 0)
    if item is None or item.order.customer_id != customer.id:
        abort(404)
    ok, why = check_eligibility(item)

    if request.method == "POST":
        try:
            photo = save_photo(request.files.get("photo"))
            ret = create_return(customer, item, request.form.get("reason", ""),
                                request.form.get("comment", ""), photo)
        except (WorkflowError, UploadError) as err:
            flash(str(err), "error")
            return render_template("customer/new_return.html", item=item, ok=ok, why=why,
                                   reasons=RETURN_REASONS, max_chars=COMMENT_MAX_CHARS,
                                   form=request.form), 400
        flash(f"Return {ret.return_code} created. Now pick a pickup slot.", "success")
        return redirect(url_for("customer.schedule", code=ret.return_code))

    return render_template("customer/new_return.html", item=item, ok=ok, why=why,
                           reasons=RETURN_REASONS, max_chars=COMMENT_MAX_CHARS, form={})


@bp.route("/return/<code>/schedule", methods=["GET", "POST"])
def schedule(code):
    ret = _own_return(code)
    if request.method == "POST":
        try:
            chosen = date.fromisoformat(request.form.get("slot_date", ""))
        except ValueError:
            chosen = None
        try:
            schedule_pickup(ret, chosen, request.form.get("slot_window", ""), current_customer().name)
        except (WorkflowError, InvalidTransition) as err:
            flash(str(err), "error")
            return redirect(url_for("customer.schedule", code=code))
        flash("Pickup booked. Keep the parcel packed and ready.", "success")
        return redirect(url_for("customer.track", code=code))

    return render_template("customer/schedule.html", ret=ret, dates=pickup_dates(),
                           slots=PICKUP_SLOTS, slot_hours=SLOT_HOURS)


@bp.get("/returns")
def returns():
    my = (ReturnRequest.query.filter_by(customer_id=current_customer().id)
          .order_by(ReturnRequest.created_at.desc()).all())
    return render_template("customer/returns.html", returns=my)


@bp.get("/return/<code>")
def track(code):
    ret = _own_return(code)
    return render_template("customer/track.html", ret=ret, steps=TRACK_STEPS,
                           step=step_index(ret), terminal=ret.status in TERMINAL,
                           max_attempts=MAX_PICKUP_ATTEMPTS, agents=dict(STAFF["agent"]))


@bp.post("/return/<code>/close")
def close(code):
    ret = _own_return(code)
    try:
        close_return(ret, current_customer().name)
        flash("All done. This return is closed.", "success")
    except InvalidTransition as err:
        flash(str(err), "error")
    return redirect(url_for("customer.track", code=code))
